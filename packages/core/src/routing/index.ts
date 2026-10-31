import type { EventInput, OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { Binding } from "../config/index.js";
import type { RuntimeInput, RuntimeRun } from "../runtime/index.js";
import { newEvent } from "../store/index.js";
import { admitBatch } from "./admit-batch.js";
import { type DispatchDeps, dispatchRun } from "./dispatch.js";
import { suppressLegacyBatch } from "./legacy-batch.js";
import { channelOf, matches, sessionKey, targetBinding, targetDropReason, unknownTargetReason } from "./matching.js";
import { createRoutedNotifications } from "./notifications.js";
import { batchPlugin, isParticipationBatch } from "./participation.js";
import { createPendingResults, createReporter } from "./pending.js";
import {
	batchReadyBinding,
	defaultRangeDiagnostic,
	legacyGroupBatch,
	membershipGroup,
	officialGroupDefault,
	participationCandidates,
	platformBatchBinding,
	platformGroupBinding,
	warnLegacy,
} from "./platform-group.js";
import { socialBindingAllowed, socialDecision } from "./social.js";
import type { CreateRouterOptions, RoutedRun } from "./types.js";

type Wake = "run" | "write";
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
	onWarn,
}: CreateRouterOptions) {
	const participationPlugins =
		typeof socialBatchPlugin === "boolean"
			? new Set(socialBatchPlugin ? ["social"] : [])
			: (socialBatchPlugin ?? new Set<string>());
	const warnedLegacy = new Set<string>();
	const warnedNoBatch = new Set<string>();
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
		const deps: DispatchDeps = {
			store,
			agents,
			runtime,
			report,
			finish,
			notify: (session, item) => routedNotifications.notify(session, item),
			...(onOwnerMention ? { onOwnerMention } : {}),
			...(onCommand ? { onCommand } : {}),
			...(onStart ? { onStart } : {}),
			...(onRun ? { onRun } : {}),
		};
		await Promise.all(runs.map((routed) => dispatchRun(routed, event, deps)));
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
		const legacySource =
			event.type === legacyGroupBatch && typeof inputData.through === "string"
				? await store.events.get(inputData.through)
				: undefined;
		warnLegacy(event, agents, warnedLegacy, onWarn);
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
		const channel = channels?.get(instance ?? "");
		const derivedDefaults = new Set<string>();
		const socialAgents = participationCandidates(agents.values(), {
			event,
			channel,
			instance,
			internalTarget,
			socialLoaded: participationPlugins.has("social"),
			derived: derivedDefaults,
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
		const diagnostics: Array<{
			agent: string;
			reason: string;
			revision: string;
			policy?: object;
			membership?: boolean;
			derivedDefault?: boolean;
			batchBinding?: "missing";
		}> = [];
		const runs: RoutedRun[] = [];
		const waits: Promise<RunResult>[] = [];
		for (const agent of agents.values()) {
			if (event.type === "channel.connected" && (!person || person !== agent.owner)) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			if (
				participationPlugins.size > 0 &&
				agent.social?.enabled &&
				legacySource &&
				legacySource.conv === event.conv &&
				(await suppressLegacyBatch(agent, event, legacySource, store, sessions, channels, participationPlugins))
			) {
				routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
				continue;
			}
			let batchSession: string | undefined;
			if (isParticipationBatch(event)) {
				const plugin = batchPlugin(event);
				const admitted =
					plugin &&
					inputData.agent === agent.id &&
					event.conv &&
					typeof inputData.through === "string" &&
					typeof inputData.policyRevision === "string" &&
					Array.isArray(inputData.sourceEvents)
						? await admitBatch(
								{
									agent: agent.id,
									conv: event.conv,
									through: inputData.through,
									sourceEvents: inputData.sourceEvents,
									policyRevision: inputData.policyRevision,
								},
								{ agents, store, plugins: participationPlugins, ...(channels ? { channels } : {}) },
								plugin,
							)
						: undefined;
				if (!admitted) {
					routes.push({ agent: agent.id, binding: null, dropped: "no-binding" });
					continue;
				}
				batchSession = admitted.session;
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
				(!agent.social.scope || (!!event.conv && agent.social.scope.includes(event.conv))) &&
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
			// 派生默认范围没有显式 social 配置，决策仍以该 Agent 自己的策略计算（08）。
			const policyAgent =
				selected?.owner ?? (internalTarget === agent.id || derivedDefaults.has(agent.id) ? agent : undefined);
			const mapping = selected?.mapping;
			const decision = policyAgent && socialDecision(policyAgent, event, person, channels?.get(instance ?? ""));
			// 派生默认范围没有可用批次绑定时只记录观察游标，并用可读诊断说明原因（08、11）。
			const noBatchBinding =
				!!decision && derivedDefaults.has(agent.id) && !batchReadyBinding(agent, instance, "social");
			if (decision)
				diagnostics.push({
					agent: agent.id,
					reason: decision.reason,
					...(decision.run ? { run: true } : {}),
					revision: decision.revision,
					...(membershipGroup(agent, event, channels?.get(instance ?? "")) ? { membership: true } : {}),
					...(derivedDefaults.has(agent.id) ? { derivedDefault: true } : {}),
					...(noBatchBinding ? { batchBinding: "missing" } : {}),
					...("policy" in decision ? { policy: decision.policy } : {}),
				});
			defaultRangeDiagnostic(
				{ warned: warnedNoBatch, ...(onWarn ? { warn: onWarn } : {}) },
				{ agent: agent.id, conv: event.conv, missingBatch: noBatchBinding },
			);
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
			if (!binding && agent.social?.enabled !== false && membershipGroup(agent, event, channels?.get(instance ?? "")))
				binding = platformGroupBinding(agent, channels!.get(instance!)!);
			if (!binding && batchSession) {
				const source = await store.events.get(inputData.through as string);
				if (source)
					binding = await platformBatchBinding(
						agent,
						source,
						channels?.get(instance ?? ""),
						store,
						batchPlugin(event)!,
					);
			}
			const matchedConnection = event.type === "channel.connected" && binding !== undefined;
			if (event.type === "channel.connected" && binding?.session !== "main") binding = undefined;
			if (
				isParticipationBatch(event) &&
				(binding?.match.type !== event.type ||
					binding.reply !== "none" ||
					binding.wake === "write" ||
					binding.session === "main" ||
					binding.session === "ephemeral" ||
					binding.session.per !== "conv")
			)
				binding = undefined;
			// multiAgent主人私聊可用零配置点名入口；其他未绑定输入仍丢弃并保留诊断。
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
				(decision &&
					policyAgent &&
					(membershipGroup(agent, event, channels?.get(instance ?? ""))
						? binding.session === "main"
						: !socialBindingAllowed(policyAgent, event, person, binding))) ||
				(mapping && mapping.profile !== profile)
			) {
				if (decision) diagnostics.push({ agent: agent.id, reason: "unsafe-binding", revision: decision.revision });
				routes.push({ agent: agent.id, binding: binding.id, dropped: "no-binding" });
				continue;
			}
			const { mode, key } = sessionKey(binding, event, person);
			const ensured = await sessions.ensureAgent(agent.id, profile, key, mode);
			if (isParticipationBatch(event) && ensured.session.id !== batchSession) {
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
		admitBatch: (request: Parameters<typeof admitBatch>[0], plugin: string) =>
			admitBatch(request, { agents, store, plugins: participationPlugins, ...(channels ? { channels } : {}) }, plugin),
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
