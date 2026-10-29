import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { reviewLifecycle } from "./review-lifecycle.mjs";
import { reviewPrompt } from "./review-prompts.mjs";
import { createSkillReadMarks } from "./skill-store.mjs";
import { fail } from "./store.mjs";

export { REVIEW_PRESET, REVIEW_TOOLS, reviewTools } from "./review-helpers.mjs";

import {
	AGE,
	includesFocus,
	isUserInput,
	keyOf,
	mergeFocus,
	QUIET,
	REVIEW_PRESET,
	reviewTools,
	TOOL_CALL_THRESHOLD,
	timeout,
	transcript,
} from "./review-helpers.mjs";

export { isUserInput } from "./review-helpers.mjs";
// Plugin-owned authority. No persisted grant is EVER rehydrated. Session parent metadata
// alone (including a task opened with the same preset) is not a write capability.
export function createReview(api, config, resolveScope) {
	const live = new Map(),
		grants = new Map(),
		tool = (name) => `${api.id}_${name}`,
		tools = reviewTools(api.id);
	let stopped = false,
		durable = { version: 1, sessions: {} },
		loaded,
		writes = Promise.resolve();
	const file = () => join(api.paths.data, "learning-state.json");
	const enabled = () => !stopped && config.enabled !== false;
	const toolCallThreshold = config.review?.toolCallThreshold ?? TOOL_CALL_THRESHOLD;
	const warn = (e) => api.log?.warn("Hermes learning review failed", { error: String(e) });
	const ready = () =>
		(loaded ??= (async () => {
			if (!enabled()) return;
			try {
				durable = JSON.parse(await readFile(file(), "utf8"));
				if (durable.version !== 1 || !durable.sessions) fail("invalid_learning_state");
			} catch (e) {
				if (e.code !== "ENOENT") throw e;
			}
		})());
	function save() {
		if (!enabled()) return Promise.resolve();
		const text = `${JSON.stringify(durable, null, 2)}\n`;
		writes = writes
			.catch(() => {})
			.then(async () => {
				await mkdir(api.paths.data, { recursive: true });
				const temp = `${file()}.tmp`;
				await writeFile(temp, text, { mode: 0o600 });
				await rename(temp, file());
			});
		return writes;
	}
	function state(id) {
		if (!live.has(id))
			live.set(id, {
				generation: 0,
				key: null,
				busy: false,
				last: 0,
				snapshot: null,
				pending: null,
				running: null,
				timer: null,
				turnState: { consolidationFailures: 0 },
			});
		return live.get(id);
	}
	function counts(id) {
		durable.sessions[id] ??= { memory: 0, skills: 0, inputs: [], runs: [] };
		return durable.sessions[id];
	}
	async function parent(id, ctx, allowClosed = false) {
		if (!enabled()) fail("module_disabled");
		const info = await api.sessions.get(id);
		if (
			!info ||
			(info.closed && !allowClosed) ||
			!info.agent ||
			info.mode === "task" ||
			(ctx && (ctx.agent !== info.agent || ctx.profile !== info.profile))
		)
			fail("review_parent_denied");
		const scope = await resolveScope(info);
		return { info, scope };
	}
	const active = (g) =>
		enabled() && grants.get(g.session) === g && live.get(g.parent)?.generation === g.generation && !g.revoked;
	function revoke(g) {
		if (!g) return;
		g.revoked = true;
		grants.delete(g.session);
	}
	function cleanup(g) {
		if (!g) return Promise.resolve();
		revoke(g); // synchronous revocation precedes abort/close and their possibly slow ack
		return (async () => {
			try {
				await api.sessions.abort(g.session);
			} finally {
				await api.sessions.close(g.session);
			}
		})().catch(warn);
	}
	function clearTimer(s) {
		if (s.timer) clearTimeout(s.timer);
		s.timer = null;
	}
	function arm(id) {
		const s = state(id);
		clearTimer(s);
		if (!enabled() || !s.pending || s.busy || s.running || s.opening) return;
		s.timer = setTimeout(
			() => {
				s.timer = null;
				void launch(id).catch(async (error) => {
					warn(error);
					counts(id).lastResult = { status: "error", reason: String(error) };
					counts(id).pending = null;
					s.pending = null;
					await save();
				});
			},
			Math.max(0, s.last + QUIET - Date.now()),
		);
		s.timer.unref?.();
	}
	async function preempt(s) {
		const g = s.running;
		if (!g) return;
		revoke(g);
		s.running = null;
		if (!g.attended && g.attempts < 3 && Date.now() - g.created < AGE) {
			const p = s.pending;
			s.pending = {
				...g,
				focus: mergeFocus(g.focus, p?.focus),
				attempts: g.attempts + 1,
				created: Math.min(g.created, p?.created ?? Infinity),
			};
		}
		await timeout(cleanup(g), 2000);
	}
	async function haltRequest(ctx, reason, g) {
		// pi-durable reports hook exceptions and continues. Use public cancellation,
		// not throw-as-denial. Abort joins the current invocation, so start it without
		// awaiting that join, and hold this hook until its real signal is cancelled.
		revoke(g);
		if (g) {
			const s = live.get(g.parent);
			if (s?.running === g) s.running = null;
		}
		if (ctx.signal.aborted) fail(reason);
		const cancelled = new Promise((resolve) => ctx.signal.addEventListener("abort", resolve, { once: true }));
		void api.sessions
			.abort(ctx.session)
			.then(() => api.sessions.close(ctx.session))
			.catch(warn);
		await cancelled;
		fail(reason);
	}
	async function beforeRequest(messages, ctx) {
		const g = grants.get(ctx.session);
		if (g) {
			if (!active(g)) return haltRequest(ctx, "review_grant_expired", g);
			if (++g.loops > 16) return haltRequest(ctx, "review_iteration_limit", g);
			return;
		}
		if (ctx.profile === REVIEW_PRESET) return haltRequest(ctx, "review_grant_required");
		if (!enabled() || !ctx.agent) return;
		const s = state(ctx.session),
			events = ctx.events ?? (ctx.event ? [ctx.event] : []),
			key = keyOf(events);
		s.busy = true;
		s.last = Date.now();
		if (s.key !== key) {
			// Foreground revocation has no filesystem/session lookup ahead of it.
			s.generation++;
			s.key = key;
			s.explicit = null;
			const opening = s.opening;
			if (opening && !opening.attended && opening.attempts < 3 && Date.now() - opening.created < AGE)
				s.pending = { ...opening, attempts: opening.attempts + 1 };
			s.turnState = { consolidationFailures: 0 };
			clearTimer(s);
			await preempt(s);
		}
		let p;
		try {
			p = await parent(ctx.session, ctx);
		} catch (e) {
			if (e.message === "review_parent_denied" || e.message === "scope_denied") return;
			throw e;
		}
		await ready();
		s.snapshot = {
			generation: s.generation,
			key,
			events: structuredClone(events),
			messages: structuredClone(messages),
			scope: p.scope,
		};
	}
	async function beforeTool(call, ctx) {
		const g = grants.get(ctx.session);
		if (g || ctx.profile === REVIEW_PRESET || tools.includes(call.name)) {
			if (!g || !active(g)) return { block: "review_grant_required_or_expired" };
			const allowed = [];
			if (includesFocus(g.focus, "memory")) allowed.push(...tools.slice(0, 2));
			if (includesFocus(g.focus, "skills")) allowed.push(tools[2]);
			if (!allowed.includes(call.name)) return { block: "review_tool_not_allowed_for_focus" };
			const mutation =
				call.name === tools[1]
					? "memory"
					: call.name === tools[2] && !["read", "list_archives"].includes(call.args.action)
						? "skills"
						: null;
			if (mutation) {
				await ready();
				counts(g.parent)[mutation] = 0;
				await save();
			}
			return;
		}
		if (!enabled() || !ctx.agent) return;
		const memory =
			call.name === tool("memory_edit") || (call.name === tool("memory_pending") && call.args.action === "apply");
		const skill =
			call.name === tool("skill_store") && call.args.action !== "read" && call.args.action !== "list_archives";
		if (!memory && !skill) return;
		try {
			await parent(ctx.session, ctx);
		} catch {
			return;
		}
		await ready();
		const c = counts(ctx.session);
		c[memory ? "memory" : "skills"] = 0;
		if (memory) {
			c.memoryResetInputs ??= [];
			for (const e of (ctx.events ?? (ctx.event ? [ctx.event] : [])).filter(isUserInput))
				if (!c.memoryResetInputs.includes(e.id)) c.memoryResetInputs.push(e.id);
		}
		await save();
	}
	async function end(e) {
		if (!enabled()) return;
		const d = e.data,
			g = grants.get(d.session);
		if (g) {
			g.finished = true;
			revoke(g);
			const s = state(g.parent);
			if (s.running === g) s.running = null;
			void api.sessions.close(g.session).catch(warn);
			arm(g.parent);
			return;
		}
		let p;
		try {
			p = await parent(d.session);
		} catch {
			return;
		}
		await ready();
		const c = counts(d.session),
			run = d.runId ?? e.id;
		if (c.runs.includes(run)) return;
		c.runs.push(run);
		const events = [];
		for (const id of d.inputs ?? []) {
			const found = (await api.events.query({ id, limit: 1 })).events[0];
			if (found) events.push(found);
		}
		for (const input of events.filter(isUserInput))
			if (!c.inputs.includes(input.id)) {
				c.inputs.push(input.id);
				if (!c.memoryResetInputs?.includes(input.id) && (p.scope.memory !== false || p.scope.user !== false))
					c.memory++;
			}
		await save();
		const s = state(d.session),
			snap = s.snapshot;
		// run.end is asynchronous. A later beforeRequest invalidates this capture, so never
		// read a next turn's final or use a next turn's material for an earlier run.
		if (!snap || snap.key !== keyOf(events) || snap.generation !== s.generation) return;
		const generation = s.generation;
		const items = await transcript(api, d.session);
		if (s.generation !== generation || s.snapshot !== snap) return;
		s.busy = false;
		s.last = Date.now();
		if (!events.some(isUserInput)) {
			s.pending = null;
			clearTimer(s);
			return;
		}
		const start = items.findLastIndex((item) => (d.inputs ?? []).includes(item.event));
		const tail = start < 0 ? [] : items.slice(start + 1);
		// Tool calls, not turns: run.end carries no count, so the run's transcript tail is it.
		// Interrupted runs still did the work, so count before the final-answer gate.
		if (p.scope.learning === true && p.scope.skillDir) {
			c.skills += tail.reduce((total, item) => total + (item.tools?.length ?? 0), 0);
			await save();
		}
		// SDK .04 projects pi.assistant but omits stopReason. status=aborted/limit
		// supplies the interruption bit; an actual terminal assistant text is required
		// independently of status. error+final is allowed, matching upstream finalizer.
		const final = tail.at(-1);
		if (
			["aborted", "limit"].includes(d.status) ||
			!final ||
			final.kind !== "pi.assistant" ||
			final.tools?.length ||
			!final.text.trim()
		) {
			s.pending = null;
			clearTimer(s);
			return;
		}
		const memory =
			c.memory >= 10 &&
			p.scope.writeMode === "exclusive-yonder" &&
			(p.scope.memory !== false || p.scope.user !== false);
		const skills = p.scope.learning === true && !!p.scope.skillDir && c.skills >= toolCallThreshold;
		const focus = s.explicit?.focus ?? (memory && skills ? "combined" : memory ? "memory" : skills ? "skills" : null);
		if (focus) {
			const old = s.pending;
			s.pending = {
				focus: s.explicit ? focus : mergeFocus(old?.focus, focus),
				attended: !!s.explicit,
				attempts: old?.attempts ?? 0,
				created: old?.created ?? Date.now(),
				generation,
				scope: p.scope,
				material: structuredClone({ messages: snap.messages, transcript: items.slice(start) }),
				parent: d.session,
				run,
			};
			// Nudge intervals roll over at scheduling, independently of dispatch resets.
			// A Nothing-to-save review must not run again on every subsequent turn.
			c.pending = s.pending;
			if (memory) c.memory = 0;
			if (skills) c.skills = 0;
			await save();
		} else if (s.pending) {
			s.pending = {
				...s.pending,
				generation,
				scope: p.scope,
				material: structuredClone({ messages: snap.messages, transcript: items.slice(start) }),
			};
		}
		c.pending = s.pending;
		await save();
		s.explicit = null;
		arm(d.session);
	}
	async function launch(id) {
		const s = state(id),
			job = s.pending;
		if (!enabled() || !job || s.busy || s.running || s.opening) return;
		if (Date.now() - job.created >= AGE) {
			s.pending = null;
			counts(id).pending = null;
			counts(id).lastResult = { status: "expired", reason: "review_queue_expired" };
			await save();
			return;
		}
		if (s.last + QUIET > Date.now()) {
			arm(id);
			return;
		}
		const { scope } = await parent(id, undefined, true);
		if (!enabled() || s.pending !== job || s.generation !== job.generation || s.busy) return;
		s.pending = null;
		s.opening = job;
		let session;
		try {
			session = await api.sessions.open({
				preset: REVIEW_PRESET,
				modelSource: { session: id, ...(config.model ? { fallback: config.model } : {}) },
				capabilities: ["read", "write"],
				close: "manual",
			});
		} finally {
			if (s.opening === job) s.opening = null;
		}
		// open() can race a foreground request/close/off. It grants no authority by itself.
		if (!enabled() || s.generation !== job.generation || s.busy) {
			await api.sessions.close(session.id);
			arm(id);
			return;
		}
		const g = {
			...job,
			id: randomUUID(),
			session: session.id,
			parent: id,
			scope,
			loops: 0,
			revoked: false,
			turnState: { consolidationFailures: 0 },
		};
		g.readMarks = createSkillReadMarks(g.id);
		grants.set(session.id, g);
		s.running = g;
		// Registration happens BEFORE submit. wait:true routes the result to this plugin,
		// not to the parent/source conversation. Never await LLM from an event observer.
		void api.sessions
			.submit(
				session.id,
				{ text: reviewPrompt(g.focus, g.material, g.scope, api.id, { session: g.parent, run: g.run }) },
				{ wait: true },
			)
			.then((result) => {
				if (!active(g) && !(g.finished && s.generation === g.generation)) return;
				g.result = { status: result.status, text: result.text, reason: result.reason };
				counts(id).lastResult = g.result;
				counts(id).pending = null;
				return save();
			})
			.catch(async (error) => {
				warn(error);
				if (!active(g) && !(g.finished && s.generation === g.generation)) return;
				counts(id).lastResult = { status: "error", reason: String(error) };
				counts(id).pending = null;
				await save();
			})
			.finally(() => {
				revoke(g);
				if (s.running === g) s.running = null;
				void api.sessions.close(session.id).catch(warn);
				arm(id);
			});
	}
	async function grant(ctx, focus) {
		const g = grants.get(ctx.session);
		if (!g || !active(g) || ctx.agent !== null || ctx.profile !== REVIEW_PRESET)
			fail("review_grant_required_or_expired");
		if (!includesFocus(g.focus, focus)) fail("review_focus_denied");
		const p = await parent(g.parent, undefined, true);
		if (p.scope !== g.scope || !active(g)) fail("review_grant_expired");
		return {
			scope: g.scope,
			options: {
				review: { id: g.id, origin: "background_review", attended: g.attended, session: g.parent, run: g.run },
				material: g.material,
				isActive: async () => {
					if (!active(g)) return false;
					const p = await parent(g.parent, undefined, true).catch(() => null);
					return p?.scope === g.scope && active(g);
				},
				onChange: (change) => reviewApi.onChange?.(g.parent, change),
				turnState: g.turnState,
				readMarks: g.readMarks,
				compactResult: true,
			},
		};
	}
	async function refine(args, ctx) {
		await parent(ctx.session, ctx);
		const inputs = ctx.events ?? (ctx.event ? [ctx.event] : []);
		if (!inputs.some((e) => isUserInput(e) && /^\/refine(?:\s|$)/i.test(e.data.text ?? "")))
			fail("refine_requires_user_command");
		const s = state(ctx.session);
		s.explicit = { focus: args.focus ?? "combined" };
		return {
			success: true,
			queued: true,
			attended: true,
			note: "Explicit review will run quietly after this user turn. No result is sent to the source.",
		};
	}
	const { close, stop } = reviewLifecycle({
		grants,
		live,
		arm,
		cleanup,
		clearTimer,
		timeout,
		writesDone: () => writes,
		stopNow: () => {
			stopped = true;
		},
	});
	const reviewApi = {
		status: async (id) => {
			await ready();
			return counts(id).lastResult ?? null;
		},
		beforeRequest,
		beforeTool,
		grant,
		refine,
		turnState: (ctx) => state(ctx.session).turnState,
		register() {
			api.hooks.register({ id: "hermes-learning", beforeRequest, beforeTool });
			api.events.on("run.end", end);
			api.events.on("session.close", (e) => close(e.data.session));
			api.triggers.register({
				id: "hermes-learning",
				async start() {
					if (config.enabled !== false) {
						await ready();
						for (const [id, c] of Object.entries(durable.sessions)) {
							if (!c.pending) continue;
							const s = state(id);
							s.pending = c.pending;
							s.generation = c.pending.generation;
							arm(id);
						}
					}
				},
				stop,
			});
		},
	};
	return reviewApi;
}
