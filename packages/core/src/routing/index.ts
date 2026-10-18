import type { EventInput, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import { newEvent, type Store } from "../store/index.js";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Runtime, RuntimeInput, RuntimeRun } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";

type Wake = "run" | "write";
type PreparedInput = RuntimeInput;
interface RoutedRun { agent: string; binding: Binding; session: string; wake: Wake }
interface CreateRouterOptions {
	store: Store;
	sessions: Sessions;
	runtime: () => Runtime;
	agents: Map<string, AgentConfig>;
	prepareInput?: (session: SessionInfo, event: YEvent, wake: Wake) => PreparedInput | Promise<PreparedInput>;
	onStart?: (session: SessionInfo, event: YEvent, waiter: boolean) => ((part: OutputPart) => void) | undefined;
	onRun?: (session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean) => void | Promise<void>;
	onReport?: (error: unknown) => void;
}

const asArray = (value: string | string[] | undefined) => value === undefined ? undefined : Array.isArray(value) ? value : [value];
const channelOf = (ref?: string) => ref?.startsWith("conv:") ? ref.split(":", 3)[1] : undefined;
const typeMatches = (pattern: string, type: string) => pattern.endsWith(".*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type;

async function matches(binding: Binding, event: YEvent, agent: AgentConfig, store: Store): Promise<boolean> {
	const match = binding.match;
	if (!typeMatches(match.type ?? "message.in", event.type)) return false;
	if (match.conv && !asArray(match.conv)!.includes(event.conv ?? "")) return false;
	const channel = channelOf(event.conv);
	if (match.channel && !asArray(match.channel)!.includes(channel ?? "")) return false;
	const data = event.data as { kind?: unknown; mentioned?: unknown; target?: unknown };
	if (match.kind && (event.type !== "message.in" || !asArray(match.kind)!.includes(String(data.kind ?? "")))) return false;
	if (match.from) {
		if (!event.from?.startsWith("acct:")) return false;
		const expected = asArray(match.from)!;
		const account = await store.identity().account(event.from);
		const relation = !account?.person ? "stranger" : account.person === agent.owner ? "owner" : "known";
		for (const value of expected) {
			if (value === relation) return true;
			if (value.startsWith("acct:") && value === event.from) return true;
			if (value.startsWith("person:") && account?.person === value) return true;
		}
		return false;
	}
	return true;
}

function sessionKey(binding: Binding, event: YEvent, accountPerson?: string): { mode: "main" | "persistent" | "ephemeral"; key: string } {
	if (binding.session === "main") return { mode: "main", key: "main" };
	if (binding.session === "ephemeral") return { mode: "ephemeral", key: event.id };
	if (binding.session.per === "conv") {
		if (!event.conv) throw new Error("Persistent conv session requires event.conv");
		return { mode: "persistent", key: `conv:${event.conv}` };
	}
	if (!event.from) throw new Error(`Persistent ${binding.session.per} session requires event.from`);
	if (binding.session.per === "from") return { mode: "persistent", key: `from:${event.from}` };
	return accountPerson
		? { mode: "persistent", key: `person:${accountPerson}` }
		: { mode: "persistent", key: `from:${event.from}` };
}

export function createRouter({ store, sessions, runtime, agents, prepareInput, onStart, onRun, onReport = () => {} }: CreateRouterOptions) {
	const pending = new Map<string, Set<(result: RunResult) => void>>();
	const handledRuns = new Set<string>();

	const report = (error: unknown) => { try { onReport(error); } catch { /* Reporting cannot interrupt event delivery. */ } };
	const resultKey = (agent: string, event: string) => `${agent}\0${event}`;
	const waitFor = (agent: string, event: string) => {
		const key = resultKey(agent, event);
		let resolve!: (result: RunResult) => void;
		const promise = new Promise<RunResult>(done => { resolve = done; });
		const group = pending.get(key) ?? new Set();
		group.add(resolve);
		pending.set(key, group);
		return promise;
	};
	const finish = (agent: string, event: string, result: RunResult) => {
		const key = resultKey(agent, event), group = pending.get(key);
		if (!group) return;
		pending.delete(key);
		for (const resolve of group) resolve(result);
	};

	async function complete(sessionId: string, session: NonNullable<Awaited<ReturnType<Store["sessions"]["get"]>>>, current: YEvent, run: RuntimeRun, waiter: boolean): Promise<void> {
		const runKey = `${sessionId}\0${run.runId}`;
		const inputIds = [...new Set([...run.inputs, current.id])];
		if (!handledRuns.has(runKey)) {
			handledRuns.add(runKey);
			const inputs = (await Promise.all(inputIds.map(id => store.events.get(id)))).filter((event): event is YEvent => !!event);
			const hasWaiter = waiter || inputIds.some(id => pending.has(resultKey(session.agent ?? "", id)));
			try { await onRun?.(session, run, inputs.length ? inputs : [current], hasWaiter); } catch (error) { report(error); }
			if (session.mode === "ephemeral" || session.mode === "task") {
				try { await sessions.closeSession(sessionId, "completed"); } catch (error) { report(error); }
			}
		}
		for (const id of inputIds) finish(session.agent ?? "", id, { agent: session.agent, session: sessionId, status: run.status, text: run.text, ...(run.reason ? { reason: run.reason } : {}) });
	}

	async function dispatch(event: YEvent, runs: RoutedRun[]): Promise<void> {
		await Promise.all(runs.map(async routed => {
			try {
				const session = await store.sessions.get(routed.session);
				if (!session) throw new Error(`Missing routed session: ${routed.session}`);
				const prepared = await prepareInput?.(session, event, routed.wake);
				const data = event.data as { text?: string; attachments?: RuntimeInput["attachments"] };
				const waiter = pending.has(resultKey(session.agent ?? "", event.id));
				const startedOutput = routed.wake === "run" ? onStart?.(session, event, waiter) : undefined;
				const output = (part: OutputPart) => {
					prepared?.onOutput?.(part);
					try { startedOutput?.(part); } catch (error) { report(error); }
				};
				const source = prepared ?? { text: data.text ?? "" };
				const attachments = source.attachments ?? data.attachments;
				const input: RuntimeInput = {
					text: source.text,
					event: prepared?.event ?? event,
					wake: routed.wake,
					busy: routed.binding.busy ?? "followup",
					...(attachments ? { attachments } : {}),
					...(source.requestId ? { requestId: source.requestId } : {}),
					...((source.onOutput || startedOutput) ? { onOutput: output } : {}),
				};
				const run = await runtime().submit(session.id, input);
				if (routed.wake === "run") await complete(session.id, session, event, run, pending.has(resultKey(session.agent ?? "", event.id)));
			} catch (error) {
				report(error);
				if (routed.wake === "write") return;
				const run: RuntimeRun = { runId: `error:${event.id}`, status: "error", text: "", reason: error instanceof Error ? error.message : String(error), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, inputs: [event.id] };
				const session = await store.sessions.get(routed.session);
				if (session) await complete(routed.session, session, event, run, pending.has(resultKey(session.agent ?? "", event.id)));
				else finish(routed.agent, event.id, { agent: routed.agent, session: routed.session, status: "error", text: "", ...(run.reason ? { reason: run.reason } : {}) });
			}
		}));
	}

	async function prepare(eventInput: EventInput, waiting: boolean) {
		const event = newEvent(eventInput);
		const data = event.data as { target?: unknown };
		const internalTarget = event.type === "message.in" && channelOf(event.conv) === "agent" && typeof data.target === "string" ? data.target : undefined;
		const routes: NonNullable<YEvent["routes"]> = [];
		const runs: RoutedRun[] = [];
		const waits: Promise<RunResult>[] = [];
		for (const agent of agents.values()) {
			if (internalTarget && internalTarget !== agent.id) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			let binding: Binding | undefined;
			for (const candidate of agent.bindings) if (await matches(candidate, event, agent, store)) { binding = candidate; break; }
			if (!binding) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			const profile = binding.profile ?? agent.defaultProfile;
			const person = event.from?.startsWith("acct:") ? (await store.identity().account(event.from))?.person : undefined;
			const { mode, key } = sessionKey(binding, event, person);
			const ensured = await sessions.ensureAgent(agent.id, profile, key, mode);
			if (ensured.profileMismatch) {
				routes.push({ agent: agent.id, binding: binding.id, dropped: "profile-mismatch" });
				continue;
			}
			const data = event.data as { mentioned?: unknown };
			const wake: Wake = (binding.wake ?? "run") === "mention" && data.mentioned !== true ? "write" : binding.wake === "write" ? "write" : "run";
			routes.push({ agent: agent.id, binding: binding.id, session: ensured.session.id, wake });
			runs.push({ agent: agent.id, binding, session: ensured.session.id, wake });
			if (waiting && wake === "run") waits.push(waitFor(agent.id, event.id));
		}
		event.routes = routes;
		await store.events.append(event);
		void dispatch(event, runs).catch(report);
		return { event, waits };
	}

	return {
		async emit(input: EventInput): Promise<YEvent> { return (await prepare(input, false)).event; },
		async ask(input: EventInput) {
			const { event, waits } = await prepare(input, true);
			return { event, results: await Promise.all(waits) };
		},
	};
}
