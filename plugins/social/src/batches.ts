import type { EventInput, EventQuery, PluginAPI, SocialPolicy, YEvent } from "@yonder/sdk";

interface Entry {
	source: YEvent;
	revision: string;
	policy: SocialPolicy;
}
interface State {
	entries: Entry[];
	pending?: EventInput;
	timer?: ReturnType<typeof setTimeout>;
	active?: Promise<void>;
	failed?: boolean;
	failedThrough?: string;
	direct?: Map<string, string>;
}

export class Batches {
	private readonly groups = new Map<string, State>();
	private readonly read = new Map<string, string>();
	private readonly readAt = new Map<string, number>();
	private readonly legacyPending = new Map<string, string>();
	private stopped = false;
	private started = false;
	constructor(private readonly api: PluginAPI) {}
	private key(agent: string, conv: string) {
		return `${agent}\0${conv}`;
	}
	private async *events(query: EventQuery) {
		let after = query.after;
		do {
			const page = await this.api.events.query({ ...query, limit: 1000, ...(after ? { after } : {}) });
			for (const event of page.events) yield event;
			after = page.next;
		} while (after && !this.stopped);
	}
	async start() {
		// ponytail: startup scans the ledger; add an index if event volume makes recovery slow.
		for await (const event of this.events({ type: "channel-qq.group-read" })) {
			await this.legacyRead(event);
		}
		for await (const event of this.events({ type: "channel-qq.group-batch" })) {
			const { through } = event.data as { through?: string };
			if (!event.conv || !through) continue;
			for (const route of event.routes ?? []) {
				if (route.wake !== "run" || route.dropped || !route.session) continue;
				const key = this.key(route.agent, event.conv);
				if (through > (this.read.get(key) ?? "") && through > (this.legacyPending.get(key) ?? ""))
					this.legacyPending.set(key, through);
			}
		}
		for await (const event of this.events({ type: "social.batch-read" })) {
			const data = event.data as { agent?: string; through?: string };
			if (data.agent && event.conv && data.through) {
				const key = this.key(data.agent, event.conv);
				if (data.through > (this.read.get(key) ?? "")) {
					this.read.set(key, data.through);
					this.readAt.set(key, Date.parse(event.ts));
				}
				if (data.through >= (this.legacyPending.get(key) ?? "")) this.legacyPending.delete(key);
			}
		}
		for await (const event of this.events({ type: "social.batch-ready" })) {
			const data = event.data as { agent?: string; through?: string };
			if (!event.conv || !data.agent || !data.through) continue;
			const key = this.key(data.agent, event.conv);
			if (data.through <= (this.read.get(key) ?? "")) continue;
			const state = this.groups.get(key) ?? { entries: [] };
			state.pending = { type: event.type, from: "plugin:social", conv: event.conv, data: event.data };
			this.groups.set(key, state);
		}
		for await (const event of this.events({ type: "social.batch-failed" })) {
			const data = event.data as { agent?: string; through?: string };
			if (!event.conv || !data.agent || !data.through) continue;
			const key = this.key(data.agent, event.conv);
			if (data.through <= (this.read.get(key) ?? "")) continue;
			const state = this.groups.get(key) ?? { entries: [] };
			if (((state.pending?.data as { through?: string } | undefined)?.through ?? "") > data.through) continue;
			state.failed = true;
			state.failedThrough = data.through;
			delete state.pending;
			this.groups.set(key, state);
		}
		for await (const event of this.events({ type: "routing.social-decision" })) await this.accept(event, false);
		for await (const event of this.events({ type: "message.in" })) this.direct(event);
		for await (const event of this.events({ type: "run.end" })) await this.finished(event);
		this.started = true;
		for (const [key, state] of this.groups) {
			state.entries = state.entries.filter((entry) => entry.source.id > (this.read.get(key) ?? ""));
			this.schedule(key, state);
		}
	}
	async legacyRead(event: YEvent) {
		const { through } = event.data as { through?: string };
		if (!event.conv || !through) return;
		const source = (await this.api.events.query({ id: through, conv: event.conv, type: "message.in" })).events[0];
		for (const route of source?.routes ?? []) {
			if (route.wake !== "write" || route.dropped) continue;
			const key = this.key(route.agent, event.conv);
			if (through > (this.read.get(key) ?? "")) {
				this.read.set(key, through);
				this.readAt.set(key, Date.parse(event.ts));
			}
			if (through >= (this.legacyPending.get(key) ?? "")) this.legacyPending.delete(key);
			const state = this.groups.get(key);
			if (state) {
				state.entries = state.entries.filter((entry) => entry.source.id > through);
				this.schedule(key, state);
			}
		}
	}
	direct(event: YEvent) {
		const data = event.data as {
			kind?: string;
			mentioned?: boolean;
			social?: { mentions?: { bot?: boolean; everyone?: boolean } };
		};
		if (!event.conv || (data.kind !== "group" && data.kind !== "channel")) return;
		const bot = data.social?.mentions?.bot ?? (data.mentioned === true && data.social?.mentions?.everyone !== true);
		if (!bot) return;
		for (const route of event.routes ?? []) {
			if (route.wake !== "run" || !route.session || route.dropped) continue;
			const key = this.key(route.agent, event.conv);
			const state = this.groups.get(key);
			if (
				!state?.entries.some(
					(entry) => entry.source.id < event.id && entry.source.routes?.some((item) => item.session === route.session),
				)
			)
				continue;
			state.direct ??= new Map();
			state.direct.set(event.id, route.session);
			this.groups.set(key, state);
			if (state.timer) clearTimeout(state.timer);
			delete state.timer;
		}
	}
	async finished(event: YEvent) {
		const data = event.data as { inputs?: string[]; session?: string; status?: string };
		for (const [key, state] of this.groups) {
			const ids = (data.inputs ?? []).filter((id) => state.direct?.get(id) === data.session);
			if (!ids.length) continue;
			for (const id of ids) state.direct?.delete(id);
			if (data.status === "done" && !state.pending && !state.active) {
				const lastInput = ids.sort().at(-1);
				const consumed = state.entries.filter(
					(entry) =>
						entry.source.id < (lastInput ?? "") && entry.source.routes?.some((route) => route.session === data.session),
				);
				const through = consumed.at(-1)?.source.id;
				if (through) {
					const [agent, conv] = key.split("\0") as [string, string];
					await this.api.events.emit({
						type: "social.batch-read",
						from: "plugin:social",
						conv,
						parent: event.id,
						data: { msgId: `direct:${event.id}:${agent}:${through}`, agent, through },
					});
					this.read.set(key, through);
					this.readAt.set(key, Date.now());
					state.entries = state.entries.filter((entry) => entry.source.id > through);
				}
			}
			this.schedule(key, state);
		}
	}
	async accept(event: YEvent, schedule = true) {
		const data = event.data as { agent?: string; reason?: string; revision?: string; policy?: SocialPolicy };
		if (this.stopped || data.reason !== "batch" || !data.agent || !data.revision || !event.parent) return;
		const source = (await this.api.events.query({ id: event.parent })).events[0];
		const route = source?.routes?.find((item) => item.agent === data.agent && item.wake === "write" && !item.dropped);
		if (!source?.conv || !route?.session) return;
		const key = this.key(data.agent, source.conv);
		if (source.id <= (this.read.get(key) ?? "")) return;
		let state = this.groups.get(key);
		if (!state) {
			state = { entries: [] };
			this.groups.set(key, state);
		}
		if (state.entries.some((entry) => entry.source.id === source.id)) return;
		state.entries.push({ source, revision: data.revision, policy: data.policy ?? {} });
		state.entries.sort((a, b) => a.source.id.localeCompare(b.source.id));
		if (!state.failedThrough || source.id > state.failedThrough) {
			delete state.failed;
			delete state.failedThrough;
		}
		if (schedule && this.started) this.schedule(key, state);
	}
	private schedule(key: string, state: State) {
		if (state.timer) clearTimeout(state.timer);
		delete state.timer;
		const first = state.entries[0];
		if (
			!this.started ||
			this.stopped ||
			state.active ||
			state.failed ||
			this.legacyPending.has(key) ||
			state.direct?.size ||
			(!first && !state.pending)
		)
			return;
		if (!state.pending && (first?.policy.batch?.run !== true || first.policy.judge)) return;
		const policy = first?.policy.batch;
		const due =
			state.pending || state.entries.length >= (policy?.count ?? 20)
				? 0
				: Math.max(0, Date.parse(first?.source.ts ?? "") + (policy?.delaySeconds ?? 60) * 1000 - Date.now());
		const delay = state.pending
			? 0
			: Math.max(due, (this.readAt.get(key) ?? 0) + (first?.policy.minIntervalSeconds ?? 60) * 1000 - Date.now());
		state.timer = setTimeout(() => {
			delete state.timer;
			state.active = this.flush(key, state)
				.catch((error) => {
					state.failed = true;
					this.api.log.warn("Social batch paused until new input", { error: String(error) });
				})
				.finally(() => {
					delete state.active;
					this.schedule(key, state);
				});
		}, delay);
		state.timer.unref();
	}
	private async flush(key: string, state: State) {
		const [agent, conv] = key.split("\0") as [string, string];
		const pending = state.pending;
		const first = state.entries[0];
		if (!first && !pending) return;
		if (pending) {
			await this.finish(key, state, pending);
			return;
		}
		if (!first) return;
		const session = first.source.routes?.find((route) => route.agent === agent)?.session;
		const entries: Entry[] = [];
		let bytes = 0;
		for (const entry of state.entries) {
			if (
				entry.revision !== first.revision ||
				entry.source.routes?.find((route) => route.agent === agent)?.session !== session
			)
				break;
			const text = (entry.source.data as { text?: unknown }).text;
			const size = typeof text === "string" ? Buffer.byteLength(text) : 0;
			if (!entries.length && size > (first.policy.batch?.maxBytes ?? 16384))
				throw new Error("Message exceeds batch byte limit");
			if (
				entries.length &&
				(entries.length >= (first.policy.batch?.maxMessages ?? 100) ||
					bytes + size > (first.policy.batch?.maxBytes ?? 16384))
			)
				break;
			entries.push(entry);
			bytes += size;
		}
		const through = entries.at(-1)?.source.id;
		if (!through) return;
		const msgId = `batch:${agent}:${conv}:${first.revision}:${through}`;
		const input = {
			type: "social.batch-ready",
			from: "plugin:social",
			conv,
			data: {
				msgId,
				agent,
				through,
				sourceEvents: entries.map((entry) => entry.source.id),
				policyRevision: first.revision,
			},
		};
		state.pending = input;
		await this.finish(key, state, input);
	}
	private async finish(key: string, state: State, input: EventInput) {
		const { agent, through, msgId } = input.data as { agent: string; through: string; msgId: string };
		const result = await this.api.events.ask(input);
		if (this.stopped) return;
		if (!result.results.length || result.results.some((run) => run.status !== "done")) {
			await this.api.events.emit({
				type: "social.batch-failed",
				from: "plugin:social",
				conv: key.slice(key.indexOf("\0") + 1),
				parent: result.event.id,
				data: { msgId: `failed:${msgId}`, agent, through },
			});
			delete state.pending;
			state.failedThrough = through;
			throw new Error("Batch run did not complete");
		}
		await this.api.events.emit({
			type: "social.batch-read",
			from: "plugin:social",
			conv: key.slice(key.indexOf("\0") + 1),
			parent: result.event.id,
			data: { msgId: `read:${msgId}`, agent, through },
		});
		this.read.set(key, through);
		this.readAt.set(key, Date.now());
		delete state.pending;
		state.entries = state.entries.filter((entry) => entry.source.id > through);
	}
	async stop() {
		this.stopped = true;
		for (const state of this.groups.values()) if (state.timer) clearTimeout(state.timer);
	}
}
