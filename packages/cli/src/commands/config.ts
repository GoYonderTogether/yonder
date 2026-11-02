import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env, stderr } from "node:process";
import { inspectSkills } from "@yonder/core";
import { homeFor, managed, namedOptions, type Options, output, print, skillsUsage, UsageError } from "./context.js";

function currentInspectContext(home: string) {
	try {
		const value: unknown = JSON.parse(env.YONDER_RUNTIME_INSPECT_CONTEXT ?? "");
		if (typeof value !== "object" || value === null) return undefined;
		const { home: runtimeHome, agent, profile } = value as Record<string, unknown>;
		if (
			typeof runtimeHome === "string" &&
			typeof agent === "string" &&
			agent !== "" &&
			typeof profile === "string" &&
			profile !== "" &&
			resolve(runtimeHome) === resolve(home)
		)
			return { home: runtimeHome, agent, profile };
	} catch {}
	return undefined;
}

const short = (value: unknown, max = 96) => (typeof value === "string" ? value.slice(0, max) : undefined);
const shortList = (value: unknown, max = 12) =>
	Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(0, max) : undefined;
function operabilitySummary(value: unknown) {
	const report = value as {
		status?: string;
		limit?: number;
		truncated?: boolean;
		reason?: string;
		conversations?: Array<Record<string, unknown>>;
	};
	return {
		status: report.status ?? "unknown",
		limit: report.limit,
		truncated: report.truncated ?? false,
		reason: short(report.reason),
		conversations: (report.conversations ?? []).map((item) => {
			const history = item.history as Record<string, unknown> | undefined;
			const route = history?.route as Record<string, unknown> | undefined;
			const policy = (history?.participation as Record<string, unknown> | undefined)?.policy as
				| Record<string, unknown>
				| undefined;
			const prediction = item.prediction as Record<string, unknown> | undefined;
			const predictedParticipation = prediction?.participation as Record<string, unknown> | undefined;
			const scope = prediction?.participationScope as Record<string, unknown> | undefined;
			const defaults = scope?.defaults as Record<string, unknown> | undefined;
			const override = scope?.conversationOverride as Record<string, unknown> | undefined;
			const consumer = prediction?.consumer as Record<string, unknown> | undefined;
			const consumerReason = short(consumer?.reason, 72);
			const capabilities = prediction?.capabilities as Record<string, unknown> | undefined;
			const tools = capabilities?.tools as Record<string, unknown> | undefined;
			const execution = history?.execution as { state?: string; runs?: Array<Record<string, unknown>> } | undefined;
			const delivery = history?.delivery as { state?: string; receipts?: Array<Record<string, unknown>> } | undefined;
			const sample = item.sample as Record<string, unknown> | undefined;
			const sampleMentions = sample?.mentions as Record<string, unknown> | undefined;
			const processing = () => {
				const reason = short(predictedParticipation?.reason, 48);
				const senderFact = typeof sample?.senderIsBot === "boolean" ? `; senderIsBot=${sample.senderIsBot}` : "";
				if (prediction?.route === "dropped")
					return `route dropped${reason ? ` (participation reason=${reason})` : ""}${senderFact}; see route/history facts`;
				if (
					prediction?.wake === "write" &&
					(consumerReason === "outside-social-scope" || scope?.includesConversation === false)
				)
					return `record-only: wake=write; social consumer not applicable because scope excludes this conversation; no social batch path selected${senderFact}`;
				if (reason === "batch" || reason === "folded")
					return `policy-controlled ${reason} candidate; final route/run unproven${senderFact}`;
				if (reason && predictedParticipation?.run === false)
					return `record-only: participation reason=${reason}; no model run predicted by this participation decision${senderFact}`;
				if (prediction?.wake === "write")
					return `wake=write records input without direct model execution; later batch processing unproven${senderFact}`;
				return `wake=run configuration; current admission/execution unproven${senderFact}`;
			};
			return {
				status: item.status ?? "unknown",
				reason: short(item.reason),
				management: item.management,
				sample: sample
					? {
							eventId: short(sample.eventId),
							conv: short(sample.conv, 120),
							kind: short(sample.kind, 32),
							from: short(sample.from, 120),
							relation: sample.relation,
							senderIsBot: sample.senderIsBot,
							mentioned: sample.mentioned,
							nativeKind: short(sample.nativeKind, 48),
							mentions: sampleMentions
								? {
										bot: sampleMentions.bot,
										owner: sampleMentions.owner,
										everyone: sampleMentions.everyone,
									}
								: undefined,
						}
					: undefined,
				history: {
					route: route
						? {
								binding: short(route.binding),
								session: short(route.session),
								profile: short(route.profile),
								wake: route.wake,
								dropped: route.dropped,
							}
						: undefined,
					participation: history?.participation
						? {
								reason: (history.participation as Record<string, unknown>).reason,
								plugin: (history.participation as Record<string, unknown>).plugin,
								mode: policy?.mode,
								batchRun: (policy?.batch as Record<string, unknown> | undefined)?.run,
							}
						: undefined,
					execution: execution
						? {
								state: execution.state,
								runs: (execution.runs ?? []).slice(0, 3),
								more: Math.max(0, (execution.runs?.length ?? 0) - 3),
							}
						: undefined,
					delivery: delivery
						? {
								state: delivery.state,
								receipts: (delivery.receipts ?? []).slice(0, 3),
								more: Math.max(0, (delivery.receipts?.length ?? 0) - 3),
							}
						: undefined,
				},
				prediction: prediction
					? {
							state: prediction.state,
							route: prediction.route,
							dropReason: prediction.dropReason,
							processing: processing(),
							binding: short(prediction.binding),
							profile: short(prediction.profile),
							wake: prediction.wake,
							participation: predictedParticipation,
							participationScope: {
								enabled: scope?.enabled,
								includesConversation: scope?.includesConversation,
								mode: override?.mode ?? defaults?.mode,
								batchRun: ((override?.batch ?? defaults?.batch) as Record<string, unknown> | undefined)?.run,
							},
							consumer,
							reply: prediction.reply,
							capabilities: {
								values: shortList(capabilities?.values),
								plugins: shortList(capabilities?.plugins),
								offer: shortList(tools?.offer),
								search: shortList(tools?.search),
								channelInstances: shortList(capabilities?.channelInstances),
								messageSend: capabilities?.messageSend,
							},
						}
					: undefined,
				configuration: item.configuration,
			};
		}),
	};
}

/** `agents`/`presets`, `plugins`/`models`/`inspect` and `skills`: management over the control socket. */
export async function runConfig(command: string, options: Options, rest: string[]): Promise<number | undefined> {
	if (command === "rpc") {
		if (!rest[0] || rest.length > 2)
			throw new UsageError("Usage: yonder rpc <method> [params-json] --home <runtime-home>");
		const params: unknown = rest[1] ? JSON.parse(rest[1]) : {};
		if (!params || typeof params !== "object" || Array.isArray(params))
			throw new UsageError("RPC params must be a JSON object");
		return print(
			managed(homeFor(options), { method: rest[0], params: params as Record<string, unknown> }, true),
			options.json,
		);
	}

	if (command === "agents" || command === "presets") {
		const operation = rest[0];
		const usage = `Usage: yonder ${command} list|show <id>|create <id> --file <json> [--preset <id>]|update <id> --file <json>|validate <id> --file <json>|${command === "agents" ? "archive|remove|restore" : "remove"} <id>`;
		if (
			!operation ||
			!["list", "show", "create", "update", "validate", "archive", "remove", "restore"].includes(operation)
		)
			throw new UsageError(usage);
		if (operation === "list" && rest.length !== 1) throw new UsageError(usage);
		const id = operation === "list" ? undefined : rest[1];
		if (operation !== "list" && (!id || id.startsWith("--"))) throw new UsageError(usage);
		const flags = namedOptions(rest.slice(operation === "list" ? 1 : 2), ["--file", "--preset"], usage);
		if (["create", "update", "validate"].includes(operation) && !flags["--file"]) throw new UsageError(usage);
		const value = flags["--file"] ? JSON.parse(await readFile(resolve(flags["--file"]), "utf8")) : undefined;
		const home = homeFor(options);
		if (command === "agents" && operation === "show") {
			const config = await managed(home, { method: "management", params: { action: "agents.show", id } }, true);
			output(config, options.json);
			const runtime = currentInspectContext(home);
			if (runtime && runtime.agent === id) {
				try {
					const inspection = (await managed(
						home,
						{
							method: "management",
							params: { action: "inspect", agent: id, profile: runtime.profile },
						},
						true,
					)) as { operability?: unknown; runtimeLoaded?: unknown };
					if (!Array.isArray(inspection.runtimeLoaded))
						stderr.write("Session operability: unknown (runtime evidence unavailable; config stdout remains valid)\n");
					else
						stderr.write(
							`Session operability (current runtime; may differ from config stdout): ${JSON.stringify(operabilitySummary(inspection.operability ?? { status: "unknown" }))}\n`,
						);
				} catch {
					stderr.write("Session operability: unknown (runtime inspection unavailable)\n");
				}
			}
			return 0;
		}
		return print(
			managed(
				home,
				{ method: "management", params: { action: `${command}.${operation}`, id, preset: flags["--preset"], value } },
				true,
			),
			options.json,
		);
	}
	if (["plugins", "models", "inspect"].includes(command)) {
		let action: string, id: string | undefined, source: string | undefined;
		let flags: Record<string, string> = {};
		if (command === "inspect") {
			action = "inspect";
			flags = namedOptions(
				rest,
				["--agent", "--profile", "--conv", "--event"],
				"Usage: yonder inspect [--agent <id>] [--profile <name>] [--conv <ref>] [--event <id>]",
			);
		} else if (command === "models") {
			if (rest.length !== 1 || rest[0] !== "list") throw new UsageError("Usage: yonder models list");
			action = "models.list";
		} else {
			const operation = rest[0];
			if (
				!operation ||
				!["list", "show", "add", "remove"].includes(operation) ||
				rest.length !== (operation === "list" ? 1 : 2)
			)
				throw new UsageError("Usage: yonder plugins list|show <id>|add <directory/package>|remove <id>");
			action = `plugins.${operation}`;
			if (operation === "add") source = rest[1]?.startsWith(".") || existsSync(rest[1]!) ? resolve(rest[1]!) : rest[1];
			else id = rest[1];
		}
		const home = homeFor(options);
		const runtime = command === "inspect" ? currentInspectContext(home) : undefined;
		const inheritedAgent = Boolean(runtime && !flags["--agent"]);
		const inheritedProfile = Boolean(
			runtime && !flags["--profile"] && (!flags["--agent"] || flags["--agent"] === runtime.agent),
		);
		const agent = flags["--agent"] ?? runtime?.agent;
		const profile = flags["--profile"] ?? (inheritedProfile ? runtime?.profile : undefined);
		const inspection = managed(
			home,
			{
				method: "management",
				params: {
					action,
					...(id ? { id } : {}),
					...(source ? { source } : {}),
					...(agent ? { agent } : {}),
					...(profile ? { profile } : {}),
					...(flags["--conv"] ? { conv: flags["--conv"] } : {}),
					...(flags["--event"] ? { eventId: flags["--event"] } : {}),
				},
			},
			true,
		);
		return print(
			command === "inspect" && runtime && (inheritedAgent || inheritedProfile)
				? inspection.then((value) => ({
						...(value as object),
						inspectionContext: {
							source: "current runtime session",
							home: "matched runtime home",
							agent: inheritedAgent ? "current runtime session" : "explicit",
							profile: flags["--profile"] ? "explicit" : inheritedProfile ? "current runtime session" : "agent default",
						},
					}))
				: inspection,
			options.json,
		);
	}
	if (command !== "skills") return undefined;
	const operation = rest[0] && ["show", "add", "remove"].includes(rest[0]) ? rest[0] : undefined;
	const target = operation ? rest[1] : undefined;
	if (operation && (!target || target.startsWith("--"))) throw new UsageError(skillsUsage);
	const flags = namedOptions(
		operation ? rest.slice(2) : rest,
		operation && operation !== "show" ? ["--agent"] : ["--agent", "--profile"],
		skillsUsage,
	);
	if (!operation)
		return print(inspectSkills(homeFor(options), flags["--agent"] ?? "main", flags["--profile"]), options.json);
	return print(
		managed(
			homeFor(options),
			{
				method: "management",
				params: {
					action: `skills.${operation}`,
					...(operation === "add" ? { source: resolve(target!) } : { id: target }),
					...(flags["--agent"] ? { agent: flags["--agent"] } : {}),
					...(flags["--profile"] ? { profile: flags["--profile"] } : {}),
				},
			},
			true,
		),
		options.json,
	);
}
