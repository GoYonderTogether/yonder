import type { AgentOperabilityFact, SessionOperabilityFact } from "./operability.js";

const conversationLimit = 8;
const characterLimit = 8000;
type RecordValue = Record<string, unknown>;

const record = (value: unknown): RecordValue | undefined =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : undefined;

function pick(source: RecordValue | undefined, keys: string[]) {
	if (!source) return undefined;
	const selected = Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
	return Object.keys(selected).length ? selected : undefined;
}

function summaryFact(item: SessionOperabilityFact, includeManagement: boolean, includeConfiguration: boolean) {
	const history = record(item.history);
	const route = record(history?.route);
	const historicalParticipation = record(history?.participation);
	const policy = record(historicalParticipation?.policy);
	const execution = record(history?.execution);
	const delivery = record(history?.delivery);
	const sample = record(item.sample);
	const prediction = record(item.prediction);
	const predictedParticipation = record(prediction?.participation);
	const scope = record(prediction?.participationScope);
	const defaults = record(scope?.defaults);
	const override = record(scope?.conversationOverride);
	const consumer = record(prediction?.consumer);
	const capabilities = record(prediction?.capabilities);
	const consumerReason = consumer?.reason;
	const reason = predictedParticipation?.reason;
	const senderFact = typeof sample?.senderIsBot === "boolean" ? `; senderIsBot=${sample.senderIsBot}` : "";
	const selectedSample = pick(sample, [
		"eventId",
		"conv",
		"kind",
		"from",
		"relation",
		"senderIsBot",
		"mentioned",
		"nativeKind",
		"mentions",
	]);
	if (selectedSample && selectedSample.conv === item.selector?.conv) delete selectedSample.conv;
	if (selectedSample && selectedSample.eventId === item.selector?.eventId) delete selectedSample.eventId;
	const runs = Array.isArray(execution?.runs) ? execution.runs.slice(0, 3) : [];
	const moreRuns = Math.max(0, (Array.isArray(execution?.runs) ? execution.runs.length : 0) - runs.length);
	const receipts = Array.isArray(delivery?.receipts) ? delivery.receipts.slice(0, 3) : [];
	const moreReceipts = Math.max(
		0,
		(Array.isArray(delivery?.receipts) ? delivery.receipts.length : 0) - receipts.length,
	);
	let processing: string;
	if (prediction?.route === "dropped")
		processing = `route dropped${reason ? ` (participation reason=${reason})` : ""}${senderFact}; see route/history facts`;
	else if (
		prediction?.wake === "write" &&
		(consumerReason === "outside-social-scope" || scope?.includesConversation === false)
	)
		processing = `record-only: wake=write; social consumer not applicable because scope excludes this conversation; no social batch path selected${senderFact}`;
	else if (reason === "batch" || reason === "folded")
		processing = `policy-controlled ${reason} candidate; final route/run unproven${senderFact}`;
	else if (reason && predictedParticipation?.run === false)
		processing = `record-only: participation reason=${reason}; no model run predicted by this participation decision${senderFact}`;
	else if (prediction?.wake === "write")
		processing = `wake=write records input without direct model execution; later batch processing unproven${senderFact}`;
	else if (prediction?.wake === "run")
		processing = `wake=run configuration; current admission/execution unproven${senderFact}`;
	else
		processing = `wake/run path unknown${prediction?.state ? ` (prediction=${prediction.state})` : ""}${reason ? `; participation reason=${reason}` : ""}; current admission/execution unproven${senderFact}`;

	const result = {
		status: item.status,
		...(item.reason !== undefined ? { reason: item.reason } : {}),
		...(includeManagement && item.management ? { management: item.management } : {}),
		...(item.selector?.conv !== undefined ? { conv: item.selector.conv } : {}),
		...(item.selector?.eventId !== undefined ? { eventId: item.selector.eventId } : {}),
		...(selectedSample && Object.keys(selectedSample).length ? { sample: selectedSample } : {}),
		...(history
			? {
					history: {
						...(route ? { route: pick(route, ["binding", "session", "profile", "wake", "dropped"]) } : {}),
						...(historicalParticipation
							? {
									participation: {
										...pick(historicalParticipation, [
											"reason",
											"plugin",
											"revision",
											"repair",
											"consumerIssue",
											"profile",
										]),
										...pick(policy, ["mode"]),
										...(record(policy?.batch)?.run !== undefined ? { batchRun: record(policy?.batch)?.run } : {}),
									},
								}
							: {}),
						...(execution
							? {
									execution: {
										state: execution.state,
										...(runs.length ? { runs: runs.map((run) => pick(record(run), ["runId", "status", "path"])) } : {}),
										...(moreRuns ? { more: moreRuns } : {}),
									},
								}
							: {}),
						...(delivery
							? {
									delivery: {
										state: delivery.state,
										...(receipts.length
											? { receipts: receipts.map((receipt) => pick(record(receipt), ["eventId", "session"])) }
											: {}),
										...(moreReceipts ? { more: moreReceipts } : {}),
									},
								}
							: {}),
					},
				}
			: {}),
		...(prediction
			? {
					prediction: {
						...pick(prediction, ["state", "route", "dropReason", "binding", "profile", "wake", "reply"]),
						processing,
						...(predictedParticipation
							? {
									participation: pick(predictedParticipation, ["reason", "plugin", "revision", "run"]),
								}
							: {}),
						...(scope
							? {
									participationScope: {
										...pick(scope, ["enabled", "includesConversation"]),
										...pick(override, ["mode"]),
										...(override?.mode === undefined ? pick(defaults, ["mode"]) : {}),
										...(record(override?.batch)?.run !== undefined
											? { batchRun: record(override?.batch)?.run }
											: record(defaults?.batch)?.run !== undefined
												? { batchRun: record(defaults?.batch)?.run }
												: {}),
									},
								}
							: {}),
						...(consumer
							? {
									consumer: pick(consumer, [
										"state",
										"reason",
										"binding",
										"issue",
										"profile",
										"plugin",
										"pluginSelected",
										"matchingConsumer",
										"derived",
									]),
								}
							: {}),
						...(capabilities?.messageSend !== undefined
							? { capabilities: { messageSend: capabilities.messageSend } }
							: {}),
					},
				}
			: {}),
		...(includeConfiguration && item.configuration
			? {
					configuration: pick(record(item.configuration), [
						"basis",
						"revision",
						"diskRevision",
						"acceptedRevision",
						"state",
					]),
				}
			: {}),
	};
	return result;
}

const size = (value: unknown) => JSON.stringify(value).length;

/** A compact current-Agent view for model context and the CLI; inspect retains the full projection. */
export function summarizeAgentOperability(agent: string, report: AgentOperabilityFact) {
	const facts = report.conversations ?? [];
	const limited = facts.slice(0, conversationLimit);
	const managementValues = [
		...new Map(
			facts.filter((fact) => fact.management).map((fact) => [JSON.stringify(fact.management), fact.management]),
		).values(),
	];
	const sharedManagement = managementValues.length === 1 ? managementValues[0] : undefined;
	const includeManagement = sharedManagement === undefined && managementValues.length > 1;
	const configurations = [
		...new Map(
			facts
				.filter((fact) => fact.configuration)
				.map((fact) => [JSON.stringify(fact.configuration), fact.configuration]),
		).values(),
	];
	const sharedConfiguration = configurations.length === 1 ? configurations[0] : undefined;
	const includeConfiguration = sharedConfiguration === undefined && configurations.length > 1;
	let conversations = limited.map((fact) => summaryFact(fact, includeManagement, includeConfiguration));
	let omitted = Math.max(0, facts.length - conversations.length);
	let summary = {
		agent,
		scope: { basis: "current-agent-exact-binding-conversations", globalMembershipDirectory: false },
		status: report.status,
		limit: conversationLimit,
		truncated: report.truncated || omitted > 0,
		omitted,
		...(report.reason !== undefined ? { reason: report.reason } : {}),
		...(sharedManagement ? { management: sharedManagement } : {}),
		...(sharedConfiguration ? { configuration: sharedConfiguration } : {}),
		conversations,
	};
	while (size(summary) > characterLimit && conversations.length) {
		conversations = conversations.slice(0, -1);
		omitted++;
		summary = { ...summary, conversations, omitted, truncated: true };
	}
	if (size(summary) > characterLimit) {
		return {
			agent,
			scope: { basis: "current-agent-exact-binding-conversations", globalMembershipDirectory: false },
			status: "unknown" as const,
			limit: conversationLimit,
			truncated: true,
			omitted: facts.length,
			reason: "summary exceeds the context size limit; inspect for complete facts",
			conversations: [],
		};
	}
	return summary;
}
