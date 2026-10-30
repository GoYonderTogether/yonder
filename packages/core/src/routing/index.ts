import type { EventInput, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { RuntimeInput, RuntimeRun } from "../runtime/index.js";
import { newEvent, type Store } from "../store/index.js";
import { admitBatch } from "./admit-batch.js";
import { suppressLegacyBatch } from "./legacy-batch.js";
import { channelOf, matches, sessionKey, targetBinding, targetDropReason, unknownTargetReason } from "./matching.js";
import { createRoutedNotifications } from "./notifications.js";
import { createPendingResults, createReporter } from "./pending.js";
import { socialBindingAllowed, socialDecision } from "./social.js";
import type { CreateRouterOptions } from "./types.js";

type Wake = "run" | "write";
interface RoutedRun {
	agent: string;
	session: string;
	wake: Wake;
}

export function createRouter({
	channels,
	store,
	sessions,
	runtime,
	agents,
	notificationLevel,
	notifications,
	socialBatchPlugin,
	onOwnerMention,
	onStart,
	onRun,
	onCommand,
	onReport = () => {},
}: CreateRouterOptions) {
	const report = createReporter(onReport);
	const routedNotifications = createRoutedNotifications(runtime, report, notificationLevel, notifications);
	const { waitFor, finish } = createPendingResults();

	async function finishIdle(session: SessionInfo) {
		for (const event of await store.events.waitingInputs(session.id)) {
			let saved = await store.events.agentResult(session.id, event.id);
			if (!saved && (await runtime().hasPendingWork(session.id, event.id))) continue;
			const last = saved ? undefined : await runtime().lastResult(session.id, event.id);
			if (!saved && !last) continue;
			if (!saved)
				saved = await store.events.record({
					type: "agent.result",
					parent: event.id,
					data: {
						session: session.id,
						job: event.id,
						runId: last!.runId,
						status: last!.status,
						...(last!.reason ? { reason: last!.reason } : {}),
					},
				});
			const data = saved.data as { runId: string; status: RunResult["status"]; reason?: string };
			finish(session.agent ?? "", event.id, {
				agent: session.agent,
				session: session.id,
				status: data.status,
				text: await runtime().resultText(session.id, data.runId),
				...(data.reason ? { reason: data.reason } : {}),
			});
		}
	}

	async function dispatch(event: YEvent, runs: RoutedRun[]): Promise<void> {
		await Promise.all(
			runs.map(async (routed) => {
				try {
					const session = await store.sessions.get(routed.session);
					if (!session) throw new Error(`Missing routed session: ${routed.session}`);
					const data = event.data as { kind?: unknown; social?: { mentions?: { owner?: boolean } } };
					const ownerMention =
						event.type === "message.in" &&
						(data.kind === "group" || data.kind === "channel") &&
						agents.get(routed.agent)?.social?.enabled === true &&
						data.social?.mentions?.owner === true;
					if (ownerMention) await onOwnerMention?.(session, event).catch(report);
					const notification = routedNotifications.notify(session.id, event);
					if (notification) await notification;
					if (routed.wake === "run") {
						const command = await onCommand?.(session, event);
						if (command) {
							finish(routed.agent, event.id, command);
							return;
						}
					}
					const inputData = event.data as { text?: string; attachments?: RuntimeInput["attachments"] };
					const waiter = event.routes?.find((route) => route.session === session.id)?.waiting ?? false;
					const startedOutput = routed.wake === "run" ? onStart?.(session, event, waiter) : undefined;
					const output = (part: OutputPart, runId?: string) => {
						try {
							startedOutput?.(part, runId);
						} catch (error) {
							report(error);
						}
					};
					const attachments = inputData.attachments;
					const input: RuntimeInput = {
						text: inputData.text ?? "",
						event,
						wake: routed.wake,
						busy: event.routes?.find((route) => route.session === session.id)?.busy ?? "steer",
						...(attachments ? { attachments } : {}),
						requestId:
							event.type === "runtime.tool-result"
								? `background:${(event.data as { job: string }).job}`
								: event.type === "runtime.continuation"
									? `continuation:${(event.data as { job: string }).job}`
									: `event:${event.id}`,
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
				return;
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
						const session = await store.sessions.get(route.session);
						if (session) await finishIdle(session);
					}
			return { event: previous, waits };
		}
		const event = newEvent(eventInput);
		const inputData = event.data as {
			target?: unknown;
			account?: unknown;
			kind?: unknown;
			agent?: unknown;
			through?: unknown;
			policyRevision?: unknown;
			sourceEvents?: unknown;
		};
		const batchSource =
			event.type === "social.batch-ready" && event.from === "plugin:social" && typeof inputData.through === "string"
				? await store.events.get(inputData.through)
				: undefined;
		const legacySource =
			event.type === "channel-qq.group-batch" && typeof inputData.through === "string"
				? await store.events.get(inputData.through)
				: undefined;
		const sourceIds = Array.isArray(inputData.sourceEvents) ? inputData.sourceEvents : [];
		const batchSources =
			event.type === "social.batch-ready" &&
			sourceIds.length > 0 &&
			sourceIds.length <= 100 &&
			sourceIds.every((id, index) => typeof id === "string" && (!index || sourceIds[index - 1] < id)) &&
			sourceIds.at(-1) === inputData.through
				? await Promise.all(sourceIds.map((id) => store.events.get(id)))
				: [];
		const internalTarget =
			(event.type === "message.in" || event.type === "channel.connected") &&
			(channelOf(event.conv) === "agent" || channels?.get(channelOf(event.conv) ?? "")?.multiAgent === true) &&
			typeof inputData.target === "string"
				? inputData.target
				: undefined;
		const routes: NonNullable<YEvent["routes"]> = [];
		const account =
			event.type === "channel.connected" && typeof inputData.account === "string" ? inputData.account : event.from;
		const person = account?.startsWith("acct:") ? (await store.identity().account(account))?.person : undefined;
		const instance = channelOf(event.conv);
		const socialAgents = [...agents.values()].filter((agent) => {
			if (!agent.social?.enabled || event.type !== "message.in" || internalTarget || instance === "agent") return false;
			const scope = agent.profiles[agent.defaultProfile]?.channelInstances ?? agent.defaults?.channelInstances;
			return instance === "console" || !scope || (!!instance && scope.includes(instance));
		});
		const subjects = [event.conv, event.from, person].filter((value): value is string => !!value);
		const mappings = socialAgents.map((owner) => ({
			owner,
			mapping: subjects
				.map((subject) => owner.social?.mappings?.find((item) => item.subject === subject))
				.find(Boolean),
		}));
		const winningSubject = subjects.find((subject) => mappings.some((item) => item.mapping?.subject === subject));
		const winningMappings = mappings.filter((item) => item.mapping?.subject === winningSubject && item.mapping);
		const diagnostics: Array<{ agent: string; reason: string; revision: string; policy?: object }> = [];
		const runs: RoutedRun[] = [];
		const waits: Promise<RunResult>[] = [];
		for (const agent of agents.values()) {
			if (event.type === "channel.connected" && (!person || person !== agent.owner)) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (
				socialBatchPlugin &&
				agent.social?.enabled &&
				legacySource &&
				legacySource.conv === event.conv &&
				(await suppressLegacyBatch(agent, event, legacySource, store, sessions, channels))
			) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (event.type === "social.batch-ready") {
				const sourceRoute = batchSource?.routes?.find(
					(route) => route.agent === agent.id && route.wake === "write" && !route.dropped,
				);
				const sourcePerson = batchSource?.from?.startsWith("acct:")
					? (await store.identity().account(batchSource.from))?.person
					: undefined;
				const decision =
					batchSource &&
					socialDecision(agent, batchSource, sourcePerson, channels?.get(channelOf(batchSource.conv) ?? ""));
				if (
					inputData.agent !== agent.id ||
					!event.conv ||
					event.conv !== batchSource?.conv ||
					!sourceRoute?.session ||
					batchSources.length !== sourceIds.length ||
					!batchSources.length ||
					batchSources.some(
						(source) =>
							source?.type !== "message.in" ||
							source.conv !== event.conv ||
							!source.routes?.some(
								(route) =>
									route.agent === agent.id &&
									route.session === sourceRoute.session &&
									route.wake === "write" &&
									!route.dropped,
							),
					) ||
					decision?.reason !== "batch" ||
					decision.revision !== inputData.policyRevision
				) {
					routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
					continue;
				}
			}
			if (internalTarget && internalTarget !== agent.id) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (agent.archivedAt) {
				routes.push({ agent: agent.id, binding: null, dropped: "agent-disabled" });
				continue;
			}
			if (
				agent.social?.enabled &&
				event.type === "message.in" &&
				!internalTarget &&
				instance !== "agent" &&
				!socialAgents.includes(agent)
			) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (winningMappings.length && (winningMappings.length !== 1 || winningMappings[0]?.mapping?.agent !== agent.id)) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			const own = mappings.find((item) => item.owner.id === agent.id);
			const targeted = winningMappings.filter((item) => item.mapping?.agent === agent.id);
			if (own?.mapping && own.mapping.agent !== agent.id) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (targeted.length > 1) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			const selected = targeted[0] ?? own;
			const policyAgent = selected?.owner;
			const mapping = selected?.mapping;
			const decision = policyAgent && socialDecision(policyAgent, event, person, channels?.get(instance ?? ""));
			if (decision)
				diagnostics.push({
					agent: agent.id,
					reason: decision.reason,
					revision: decision.revision,
					...((decision.reason === "batch" || decision.reason === "folded") && "policy" in decision
						? { policy: decision.policy }
						: {}),
				});
			const ownerMention =
				decision?.reason === "mention" &&
				(event.data as { social?: { mentions?: { owner?: boolean } } }).social?.mentions?.owner === true;
			if (decision && !decision.run && decision.reason !== "batch" && decision.reason !== "folded" && !ownerMention) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			let binding: Binding | undefined;
			for (const candidate of agent.bindings)
				if (
					!(internalTarget && inputData.kind === "parent-request" && candidate.session !== "main") &&
					(await matches(candidate, event, agent, store))
				) {
					binding = candidate;
					break;
				}
			const matchedConnection = event.type === "channel.connected" && binding !== undefined;
			if (event.type === "channel.connected" && binding?.session !== "main") binding = undefined;
			if (
				event.type === "social.batch-ready" &&
				(binding?.match.type !== "social.batch-ready" ||
					binding.reply !== "none" ||
					binding.wake === "write" ||
					binding.session === "main" ||
					binding.session === "ephemeral" ||
					binding.session.per !== "conv")
			)
				binding = undefined;
			// 点名叫到本 Agent 却没命中任何配置绑定：multiAgent 渠道（card、console）的主人私聊走零配置
			// 点名入口，其余情况仍然丢弃，但要留下可诊断的原因（spec 03「不可路由要留可诊断原因」）。
			if (!binding && !matchedConnection && internalTarget === agent.id)
				binding = targetBinding(agent, event, instance, !!person && person === agent.owner);
			if (!binding) {
				const reason = targetDropReason(event, agent.id, !!person && person === agent.owner);
				if (reason) report(reason);
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			const profile = binding.profile ?? agent.defaultProfile;
			const scope = agent.profiles[profile]?.channelInstances ?? agent.defaults?.channelInstances;
			if (
				(decision || event.type === "channel.connected") &&
				instance !== "console" &&
				scope &&
				(!instance || !scope.includes(instance))
			) {
				if (decision)
					diagnostics.push({ agent: agent.id, reason: "channel-outside-scope", revision: decision.revision });
				routes.push({ agent: agent.id, binding: binding.id, dropped: "no-binding" });
				continue;
			}
			if (
				(decision && policyAgent && !socialBindingAllowed(policyAgent, event, person, binding)) ||
				(mapping && mapping.profile !== profile)
			) {
				if (decision) diagnostics.push({ agent: agent.id, reason: "unsafe-binding", revision: decision.revision });
				routes.push({ agent: agent.id, binding: binding.id, dropped: "no-binding" });
				continue;
			}
			const { mode, key } = sessionKey(binding, event, person);
			const ensured = await sessions.ensureAgent(agent.id, profile, key, mode);
			if (
				event.type === "social.batch-ready" &&
				!batchSource?.routes?.some(
					(route) =>
						route.agent === agent.id &&
						route.session === ensured.session.id &&
						route.wake === "write" &&
						!route.dropped,
				)
			) {
				routes.push({ agent: agent.id, binding: binding.id, dropped: "no-binding" });
				continue;
			}
			if (ensured.profileMismatch) {
				routes.push({ agent: agent.id, binding: binding.id, dropped: "profile-mismatch" });
				continue;
			}
			if (event.type === "channel.connected" && binding.reply === "none") {
				const config = await sessions.resolveSession(ensured.session.id);
				const send = runtime()
					.describeTools(config)
					.find((tool) => tool.name === "message_send");
				if (!send || (send.exposure !== "offer" && send.exposure !== "search")) {
					routes.push({ agent: agent.id, binding: binding.id, dropped: "send-unavailable" });
					continue;
				}
			}
			const data = event.data as { mentioned?: unknown; social?: { mentions?: { bot?: boolean } } };
			const mentioned = decision ? (data.social?.mentions?.bot ?? data.mentioned) === true : data.mentioned === true;
			const wake: Wake =
				decision?.reason === "batch" || decision?.reason === "folded" || ownerMention
					? "write"
					: (binding.wake ?? "run") === "mention" && !mentioned
						? "write"
						: binding.wake === "write"
							? "write"
							: "run";
			routes.push({
				agent: agent.id,
				binding: binding.id,
				session: ensured.session.id,
				wake,
				busy: binding.busy ?? "steer",
				waiting: waiting && wake === "run",
			});
			runs.push({ agent: agent.id, session: ensured.session.id, wake });
			if (waiting && wake === "run") waits.push(waitFor(agent.id, event.id));
		}
		const ghost = internalTarget && !agents.has(internalTarget) && unknownTargetReason(event, internalTarget);
		if (ghost) report(ghost);
		event.routes = routes;
		const stored = diagnostics.length
			? await store.events.appendWithFacts(
					event,
					diagnostics.map((data) => ({ type: "routing.social-decision", parent: event.id, data })),
				)
			: await store.events.append(event);
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
		admitBatch: (request: Parameters<typeof admitBatch>[0]) =>
			admitBatch(request, { agents, store, ...(channels ? { channels } : {}) }),
		observeNotifications: routedNotifications.observe,
		finishIdle,
		finishRun: async (session: SessionInfo, _run: RuntimeRun) => finishIdle(session),
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
