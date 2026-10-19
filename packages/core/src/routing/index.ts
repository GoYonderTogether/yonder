import type { EventInput, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Runtime, RuntimeInput, RuntimeRun } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { newEvent, type Store } from "../store/index.js";

type Wake = "run" | "write";
interface RoutedRun {
	agent: string;
	session: string;
	wake: Wake;
}
interface CreateRouterOptions {
	store: Store;
	sessions: Sessions;
	runtime: () => Runtime;
	agents: Map<string, AgentConfig>;
	onStart?: (
		session: SessionInfo,
		event: YEvent,
		waiter: boolean,
	) => ((part: OutputPart, runId?: string) => void) | undefined;
	onRun?: (session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean) => void | Promise<void>;
	onCommand?: (session: SessionInfo, event: YEvent) => Promise<RunResult | undefined>;
	onReport?: (error: unknown) => void;
}

const asArray = (value: string | string[] | undefined) =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];
const channelOf = (ref?: string) => (ref?.startsWith("conv:") ? ref.split(":", 3)[1] : undefined);
const typeMatches = (pattern: string, type: string) =>
	pattern.endsWith(".*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type;

async function matches(binding: Binding, event: YEvent, agent: AgentConfig, store: Store): Promise<boolean> {
	const match = binding.match;
	if (!typeMatches(match.type ?? "message.in", event.type)) return false;
	if (match.conv && !asArray(match.conv)!.includes(event.conv ?? "")) return false;
	const channel = channelOf(event.conv);
	if (match.channel && !asArray(match.channel)!.includes(channel ?? "")) return false;
	const data = event.data as { kind?: unknown; mentioned?: unknown; target?: unknown };
	if (match.kind && (event.type !== "message.in" || !asArray(match.kind)!.includes(String(data.kind ?? ""))))
		return false;
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

function sessionKey(
	binding: Binding,
	event: YEvent,
	accountPerson?: string,
): { mode: "main" | "persistent" | "ephemeral"; key: string } {
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

export function createRouter({
	store,
	sessions,
	runtime,
	agents,
	onStart,
	onRun,
	onCommand,
	onReport = () => {},
}: CreateRouterOptions) {
	const pending = new Map<string, Set<(result: RunResult) => void>>();

	const report = (error: unknown) => {
		try {
			onReport(error);
		} catch {
			/* Reporting cannot interrupt event delivery. */
		}
	};
	const resultKey = (agent: string, event: string) => `${agent}\0${event}`;
	const waitFor = (agent: string, event: string) => {
		const key = resultKey(agent, event);
		let resolve!: (result: RunResult) => void;
		const promise = new Promise<RunResult>((done) => {
			resolve = done;
		});
		const group = pending.get(key) ?? new Set();
		group.add(resolve);
		pending.set(key, group);
		return promise;
	};
	const finish = (agent: string, event: string, result: RunResult) => {
		const key = resultKey(agent, event),
			group = pending.get(key);
		if (!group) return;
		pending.delete(key);
		for (const resolve of group) resolve(result);
	};

	async function dispatch(event: YEvent, runs: RoutedRun[]): Promise<void> {
		await Promise.all(
			runs.map(async (routed) => {
				try {
					const session = await store.sessions.get(routed.session);
					if (!session) throw new Error(`Missing routed session: ${routed.session}`);
					if (routed.wake === "run") {
						const command = await onCommand?.(session, event);
						if (command) {
							finish(routed.agent, event.id, command);
							return;
						}
					}
					const data = event.data as { text?: string; attachments?: RuntimeInput["attachments"] };
					const waiter = event.routes?.find((route) => route.session === session.id)?.waiting ?? false;
					const startedOutput = routed.wake === "run" ? onStart?.(session, event, waiter) : undefined;
					const output = (part: OutputPart, runId?: string) => {
						try {
							startedOutput?.(part, runId);
						} catch (error) {
							report(error);
						}
					};
					const attachments = data.attachments;
					const input: RuntimeInput = {
						text: data.text ?? "",
						event,
						wake: routed.wake,
						busy: event.routes?.find((route) => route.session === session.id)?.busy ?? "followup",
						...(attachments ? { attachments } : {}),
						requestId: `event:${event.id}`,
						...(startedOutput ? { onOutput: output } : {}),
					};
					await runtime().submit(session.id, input);
				} catch (error) {
					report(error);
					if (routed.wake === "write") return;
					const run: RuntimeRun = {
						runId: `error:${event.id}`,
						status: "error",
						text: "",
						reason: error instanceof Error ? error.message : String(error),
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
						inputs: [event.id],
					};
					const session = await store.sessions.get(routed.session);
					if (session) {
						if (!(await runtime().admitted(session.id, event.id)))
							await onRun?.(
								session,
								run,
								[event],
								event.routes?.find((route) => route.session === session.id)?.waiting ?? false,
							);
						finish(session.agent ?? "", event.id, {
							agent: session.agent,
							session: session.id,
							status: run.status,
							text: run.text,
							...(run.reason ? { reason: run.reason } : {}),
						});
					} else
						finish(routed.agent, event.id, {
							agent: routed.agent,
							session: routed.session,
							status: "error",
							text: "",
							...(run.reason ? { reason: run.reason } : {}),
						});
				}
			}),
		);
	}

	async function prepare(
		eventInput: EventInput,
		waiting: boolean,
	): Promise<{ event: YEvent; waits: Promise<RunResult>[] }> {
		const previous = await store.events.findInput(eventInput);
		if (previous) {
			const waits: Promise<RunResult>[] = [];
			if (waiting)
				for (const route of previous.routes ?? [])
					if (route.session && route.wake === "run" && !route.dropped) {
						const wait = waitFor(route.agent, previous.id);
						waits.push(wait);
						const ending = await store.events.runForInput(route.session, previous.id);
						if (ending) {
							const data = ending.data as unknown as RunResult;
							finish(route.agent, previous.id, {
								agent: route.agent,
								session: route.session,
								status: data.status,
								text: await runtime().responseText(route.session, previous.id),
								...(data.reason ? { reason: data.reason } : {}),
							});
						}
					}
			return { event: previous, waits };
		}
		const event = newEvent(eventInput);
		const data = event.data as { target?: unknown };
		const internalTarget =
			event.type === "message.in" && channelOf(event.conv) === "agent" && typeof data.target === "string"
				? data.target
				: undefined;
		const routes: NonNullable<YEvent["routes"]> = [];
		const runs: RoutedRun[] = [];
		const waits: Promise<RunResult>[] = [];
		for (const agent of agents.values()) {
			if (internalTarget && internalTarget !== agent.id) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			let binding: Binding | undefined;
			for (const candidate of agent.bindings)
				if (await matches(candidate, event, agent, store)) {
					binding = candidate;
					break;
				}
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
			const wake: Wake =
				(binding.wake ?? "run") === "mention" && data.mentioned !== true
					? "write"
					: binding.wake === "write"
						? "write"
						: "run";
			routes.push({
				agent: agent.id,
				binding: binding.id,
				session: ensured.session.id,
				wake,
				busy: binding.busy ?? "followup",
				waiting: waiting && wake === "run",
			});
			runs.push({ agent: agent.id, session: ensured.session.id, wake });
			if (waiting && wake === "run") waits.push(waitFor(agent.id, event.id));
		}
		event.routes = routes;
		const stored = await store.events.append(event);
		if (stored.id !== event.id) {
			for (const run of runs)
				finish(run.agent, event.id, {
					agent: run.agent,
					session: run.session,
					status: "error",
					text: "",
					reason: "输入已接纳，查询原事件结果",
				});
			return prepare(eventInput, waiting);
		}
		void dispatch(stored, runs).catch(report);
		return { event: stored, waits };
	}

	return {
		finishRun: async (session: SessionInfo, run: RuntimeRun) => {
			for (const id of run.inputs)
				finish(session.agent ?? "", id, {
					agent: session.agent,
					session: session.id,
					status: run.status,
					text: run.text,
					...(run.reason ? { reason: run.reason } : {}),
				});
		},
		async recover(): Promise<Array<() => void>> {
			const pending: Array<() => void> = [];
			let after: string | undefined;
			do {
				const page = await store.events.query({ limit: 1000, ...(after ? { after } : {}) });
				for (const event of page.events)
					for (const route of event.routes ?? []) {
						if (
							!route.session ||
							!route.wake ||
							route.dropped ||
							(await store.events.runForInput(route.session, event.id)) ||
							(await runtime().admitted(route.session, event.id))
						)
							continue;
						if (route.busy === undefined || route.waiting === undefined) {
							report(new Error(`输入 ${event.id} 缺少历史 busy/waiting，不能猜测恢复`));
							continue;
						}
						pending.push(() => {
							void dispatch(event, [{ agent: route.agent, session: route.session!, wake: route.wake! }]).catch(report);
						});
					}
				after = page.next;
			} while (after);
			return pending;
		},
		async emit(input: EventInput): Promise<YEvent> {
			return (await prepare(input, false)).event;
		},
		async ask(input: EventInput) {
			const { event, waits } = await prepare(input, true);
			return { event, results: await Promise.all(waits) };
		},
	};
}
