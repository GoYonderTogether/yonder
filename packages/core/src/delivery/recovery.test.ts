import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import type { Channel, SessionInfo } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime, type RuntimeRun } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createDelivery } from "./index.js";

// This is a real filesystem delivery sink, not a model or provider replacement.
test("per-input waiting, atomic attempts, and unknown delivery survive reopen without duplicate side effects", async () => {
	const home = await mkdtemp("/tmp/yonder-delivery-recovery-");
	let db = await openDatabase(`${home}/state.db`);
	let store = await createStore(db);
	const session: SessionInfo = {
		id: "2",
		agent: "maintainer",
		profile: "check",
		mode: "main",
		key: "main",
		version: "0.1.4",
		opened: new Date().toISOString(),
	};
	const run: RuntimeRun = {
		runId: "9",
		status: "done",
		text: "delivery-confirmed",
		inputs: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		config: {
			agent: session.agent,
			profile: session.profile,
			cwd: home,
			resolved: resolveProfile({}),
			bindings: [{ id: "source", match: {}, session: "main", reply: "auto" }],
		},
	};
	const unavailable = (): never => {
		throw new Error("This delivery-only check must not start a model");
	};
	let release!: () => void;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const channel: Channel = {
		id: "local",
		kinds: ["dm"],
		output: { stream: false, attachments: false },
		start: async () => {},
		stop: async () => {},
		send: async (target, message) => {
			// The durable run ending and its send attempt must precede the actual side effect.
			expect(await store.events.runEnd(session.id, run.runId)).toBeDefined();
			expect((await store.events.query({ type: "message.attempt" })).events.length).toBeGreaterThan(0);
			calls++;
			await appendFile(`${home}/deliveries`, `${target} ${message.text}\n`);
			await blocked;
			return { ok: true };
		},
	};
	const create = () =>
		createDelivery({
			store,
			agents: new Map(),
			channels: new Map([["local", channel]]),
			runtime: unavailable,
			sessions: createSessions({
				store,
				agents: new Map(),
				homePresets: new Map(),
				pluginPresets: new Map(),
				home,
				config: { schema: 1 },
				version: "0.1.4",
				runtime: unavailable,
			}),
		});
	try {
		await store.sessions.put(session);
		const event = (waiting: boolean, conv: string) =>
			store.events.record({ type: "message.in", conv, data: { kind: "dm", text: "Delivery recovery verification" } }, [
				{ agent: "maintainer", binding: "source", session: session.id, wake: "run", busy: "steer", waiting },
			]);
		const a = await event(true, "conv:local:caller");
		const b = await event(false, "conv:local:source");
		const c = await event(false, "conv:local:source");
		run.inputs = [a.id, b.id, c.id];
		let delivery = create();
		delivery.start();
		await Promise.all([delivery.onRun(session, run, [a, b, c]), delivery.onRun(session, run, [a, b, c])]);
		await expect.poll(() => calls).toBe(1);
		expect((await store.events.query({ type: "run.end" })).events).toHaveLength(1);
		expect((await store.events.runEnd(session.id, run.runId))?.data).toMatchObject({
			targets: [b.conv],
			replied: "source",
		});
		expect((await store.events.query({ type: "message.out" })).events).toHaveLength(0);
		release();
		await expect.poll(async () => (await store.events.query({ type: "message.out" })).events.length).toBe(1);
		expect(await readFile(`${home}/deliveries`, "utf8")).toBe("conv:local:source delivery-confirmed\n");
		// Exercise the precise external-effect / local-confirmation crash window with a real side effect.
		const interrupted = await store.events.claimAttempt({
			type: "message.attempt",
			data: { session: session.id, runId: "10", target: b.conv!, method: "send" },
		});
		expect(interrupted).toBeDefined();
		await appendFile(`${home}/deliveries`, "unconfirmed external side effect\n");
		await db.close();
		db = await openDatabase(`${home}/state.db`);
		store = await createStore(db);
		delivery = create();
		await delivery.recover();
		delivery.start();
		await delivery.onRun(session, { ...run, runId: "10", text: "must-not-repeat" }, [a, b, c]);
		await delivery.onRun(session, run, [a, b, c]);
		await delivery.recover();
		expect(
			(await store.events.query({ type: "message.unknown" })).events.map(
				(e) => (e.data as { attempt: string }).attempt,
			),
		).toEqual([interrupted]);
		expect(calls).toBe(1);
		expect(await readFile(`${home}/deliveries`, "utf8")).not.toContain("must-not-repeat");
		const attempts = await Promise.all(
			Array.from({ length: 4 }, () =>
				store.events.claimAttempt({
					type: "message.attempt",
					data: { session: session.id, runId: "11", target: b.conv!, method: "send" },
				}),
			),
		);
		expect(attempts.filter(Boolean)).toHaveLength(1);
	} finally {
		release();
		try {
			await db.close();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	}
});

test("streams belong to actual run keys, not arrival order, and old cleanup leaves the successor intact", async () => {
	const home = await mkdtemp("/tmp/yonder-stream-ownership-");
	const db = await openDatabase(`${home}/state.db`);
	const store = await createStore(db);
	const config = {
		agent: "maintainer",
		profile: "check",
		cwd: home,
		resolved: resolveProfile({}),
		bindings: [{ id: "source", match: {}, session: "main" as const, reply: "auto" as const, stream: true }],
	};
	const runtime = await Runtime.open({ home, db, config: { schema: 1 }, resolveSession: async () => config });
	try {
		const id = await runtime.create({ agent: config.agent, profile: config.profile, cwd: home });
		await runtime.configure(id); // Configuration only: no input or model task is created.
		const session: SessionInfo = {
			id,
			agent: config.agent,
			profile: config.profile,
			mode: "main",
			key: "main",
			version: "0.1.4",
			opened: new Date().toISOString(),
		};
		await store.sessions.put(session);
		const channel: Channel = {
			id: "local",
			kinds: ["dm"],
			output: { stream: true, attachments: false },
			start: async () => {},
			stop: async () => {},
			send: async () => {
				throw new Error("An already-open stream must finish through stream, not send");
			},
			stream: async (_target, parts) => {
				for await (const part of parts) await appendFile(`${home}/stream`, `${JSON.stringify(part)}\n`);
				return { ok: true };
			},
		};
		const sessions = createSessions({
			store,
			agents: new Map(),
			homePresets: new Map(),
			pluginPresets: new Map(),
			home,
			config: { schema: 1 },
			version: "0.1.4",
			runtime: () => runtime,
		});
		const delivery = createDelivery({
			store,
			agents: new Map(),
			channels: new Map([["local", channel]]),
			runtime: () => runtime,
			sessions,
		});
		delivery.start();
		const event = () =>
			store.events.record(
				{ type: "message.in", conv: "conv:local:source", data: { kind: "dm", text: "Stream ownership verification" } },
				[{ agent: config.agent, binding: "source", session: id, wake: "run", busy: "followup", waiting: false }],
			);
		const a = await event(),
			b = await event(),
			c = await event();
		const followup = delivery.onStart(session, c, false)!;
		const first = delivery.onStart(session, a, false)!;
		const steer = delivery.onStart(session, b, false)!;
		first({ type: "text", delta: "old-progress" }, "9");
		steer({ type: "text", delta: "duplicate-should-not-appear" }, "9");
		const run: RuntimeRun = {
			runId: "9",
			config,
			status: "done",
			text: "first-final",
			inputs: [a.id, b.id],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		};
		followup({ type: "text", delta: "new-progress" }, "14");
		await delivery.onRun(session, run, [a, b]);
		followup({ type: "text", delta: "successor-still-active" }, "14");
		await delivery.onRun(session, { ...run, runId: "14", text: "second-final", inputs: [c.id] }, [c]);
		await expect.poll(async () => (await store.events.query({ type: "message.out" })).events.length).toBe(2);
		const output = await readFile(`${home}/stream`, "utf8");
		for (const text of ["old-progress", "new-progress", "successor-still-active", "first-final", "second-final"])
			expect(output).toContain(text);
		expect(output).not.toContain("duplicate-should-not-appear");
	} finally {
		try {
			await runtime.close();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	}
});
