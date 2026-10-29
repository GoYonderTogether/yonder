import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { SocialAPI, SocialPolicy, ToolContext } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { Errors } from "typebox/value";
import { parseDocument } from "yaml";
import { type AgentConfig, parseAgentConfig, type YonderConfig } from "../config/index.js";
import { socialDefaults, socialPolicySchema } from "../config/social-schema.js";
import type { Principal } from "../control/method-types.js";

type Inspect = Parameters<SocialAPI["inspect"]>[0];
type Update = Parameters<SocialAPI["update"]>[0];
type Caller = ToolContext | Principal;
export class SocialError extends Error {
	constructor(
		public code: "forbidden" | "conflict" | "invalid_params",
		message: string,
		public data?: Record<string, string>,
	) {
		super(message);
	}
}
const revision = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const effectivePolicy = (defaults?: SocialPolicy, override?: SocialPolicy): SocialPolicy => ({
	...defaults,
	...override,
	...(defaults?.batch || override?.batch ? { batch: { ...defaults?.batch, ...override?.batch } } : {}),
	...(defaults?.signals || override?.signals ? { signals: { ...defaults?.signals, ...override?.signals } } : {}),
});
/** C5 机器人闸门（IMP-17）：窗口左开右闭，与 `plugins/social/src/bot-gate.ts` 的 `evaluateBotGate` 同口径。 */
export interface BotGateEvent {
	/** 消息时间：ISO 8601 或 epoch 毫秒。 */
	at: string | number;
	/** 来自另一个机器人/AI 账号时为 true；内核侧只统计这种来源，权重低于真人。 */
	bot: boolean;
}
export interface BotGateHint {
	windowMin: number;
	threshold: number;
	count: number;
	frequencies: number[];
}
export function botGateCounts(
	events: readonly BotGateEvent[],
	now: string | number,
	cfg?: { windowMin?: number; threshold?: number; history?: number },
): { inject: boolean; frequencies: number[]; hint?: BotGateHint } {
	const positive = (value: number | undefined, fallback: number): number =>
		Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : fallback;
	const windowMin = positive(cfg?.windowMin ?? socialDefaults.botGate.windowMin, 15);
	const threshold = positive(cfg?.threshold ?? socialDefaults.botGate.threshold, 3);
	const history = positive(cfg?.history ?? socialDefaults.botGate.history, 3);
	const at = typeof now === "number" ? now : Date.parse(now);
	const window = windowMin * 60_000;
	const times = events
		.filter((event) => event.bot)
		.map((event) => (typeof event.at === "number" ? event.at : Date.parse(event.at)))
		.filter((value) => Number.isFinite(value));
	// 窗口左开右闭：落在边界上的消息归后一个窗口。
	const count = (start: number, end: number) => times.filter((value) => value > start && value <= end).length;
	const frequencies = Array.from({ length: history }, (_, index) =>
		count(at - (history - index + 1) * window, at - (history - index) * window),
	);
	const current = count(at - window, at);
	if (!Number.isFinite(at) || current <= threshold) return { inject: false, frequencies };
	return { inject: true, frequencies, hint: { windowMin, threshold, count: current, frequencies } };
}

export function createSocial(options: {
	home: string;
	config: YonderConfig;
	agents: Map<string, AgentConfig>;
	assert(ctx: ToolContext): void;
	owner(agent: string, account: string): Promise<boolean>;
	target(conv: string): Promise<{ kind: "dm" | "group" | "channel"; from?: string; person?: string } | undefined>;
	record(event: { type: string; from: string; conv?: string; data: object }): Promise<unknown>;
	validate(agents: Map<string, AgentConfig>): Promise<void>;
	reload(): Promise<void>;
}) {
	const confirmations = new Map<string, { fingerprint: string; event: string }>();
	const authorize = async (agent: string, conv: string, caller: Caller, write: boolean) => {
		const target = options.agents.get(agent);
		if (!target?.social?.enabled || !/^conv:[a-z0-9-]+:\S+$/.test(conv))
			throw new SocialError("invalid_params", "Unknown social target");
		const instance = conv.split(":")[1]!;
		const source = await options.target(conv);
		if (!source) throw new SocialError("invalid_params", "Conversation kind is unknown");
		if (
			!(target.social.authorized?.conversations ?? []).includes(conv) &&
			!(
				source.kind === "dm" &&
				((source.from && target.social.authorized?.accounts?.includes(source.from)) ||
					(source.person && target.social.authorized?.people?.includes(source.person)) ||
					source.person === target.owner)
			)
		)
			throw new SocialError("forbidden", "Conversation is not authorized", { reason: "scope_denied" });
		if ("transport" in caller) {
			if (!caller.scopes.includes("admin") || !caller.scopes.includes("owner"))
				throw new SocialError("forbidden", "Owner admin required", { reason: "scope_denied" });
		} else {
			options.assert(caller);
			if (
				!caller.agent ||
				(caller.agent !== agent && !caller.capabilities.includes("cross-agent")) ||
				(write && !caller.capabilities.includes("admin")) ||
				(!write && caller.event?.conv !== conv && !caller.capabilities.includes("admin")) ||
				(caller.channelInstances && !caller.channelInstances.includes(instance))
			)
				throw new SocialError("forbidden", "Tool scope denied", { reason: "scope_denied" });
			if (
				write &&
				(!caller.event?.from ||
					caller.event.type !== "message.in" ||
					(caller.event.data as { kind?: string }).kind !== "dm" ||
					!(await options.owner(caller.agent, caller.event.from)))
			)
				throw new SocialError("forbidden", "An owner direct message is required", { reason: "scope_denied" });
		}
		const defaultScope = target.defaults?.channelInstances;
		const profileScope = target.profiles[target.defaultProfile]?.channelInstances;
		if ((defaultScope && !defaultScope.includes(instance)) || (profileScope && !profileScope.includes(instance)))
			throw new SocialError("forbidden", "Channel outside target scope", { reason: "scope_denied" });
		return { target, kind: source.kind };
	};
	const inspect = async (request: Inspect, caller: Caller) => {
		const { target: agent, kind } = await authorize(request.agent, request.conv, caller, false);
		const policy = effectivePolicy(agent.social?.defaults?.[kind], agent.social?.conversations?.[request.conv]);
		return {
			policy,
			sources: Object.fromEntries(
				Object.keys(policy).map((k) => [
					k,
					agent.social?.conversations?.[request.conv]?.[k as keyof SocialPolicy] !== undefined ? "conversation" : kind,
				]),
			),
			revision: revision(agent.social),
			capabilityGaps: ["Channel capabilities not evaluated"],
			routeReason: "not evaluated",
		};
	};
	const update = async (request: Update, caller: Caller) => {
		let before: SocialPolicy = {},
			after: SocialPolicy = {},
			current = "unknown";
		let actor = "transport" in caller ? caller.id : "agent:unknown";
		let sourceEvent: string | undefined;
		let unlock: (() => Promise<void>) | undefined;
		try {
			if (!("transport" in caller)) {
				options.assert(caller);
				actor = caller.event?.from ?? `agent:${caller.agent ?? "unknown"}`;
				sourceEvent = caller.event?.id;
			}
			const { target: agent, kind } = await authorize(request.agent, request.conv, caller, true);
			const trustedActor = "transport" in caller ? actor : (caller.event?.from ?? actor);
			unlock = await lockfile.lock(join(options.home, "yonder.yaml"));
			const entry = options.config.agents?.find((a) => a.id === request.agent);
			if (!entry || (entry.env && entry.env !== "local"))
				throw new SocialError("invalid_params", "Atomic update requires a local workspace");
			const file = join(resolve(options.home, entry.workspace), "agent.yaml");
			const original = await readFile(file, "utf8");
			const document = parseDocument(original);
			const disk = parseAgentConfig(document.toString(), file, request.agent);
			current = revision(disk.social);
			before = effectivePolicy(disk.social?.defaults?.[kind], disk.social?.conversations?.[request.conv]);
			if (request.expectedRevision !== current)
				throw new SocialError("conflict", "Policy revision changed", { currentRevision: current });
			const { mappings, ...patch } = request.patch;
			if (mappings !== undefined) throw new SocialError("invalid_params", "Mapping updates are not supported");
			const errors = [...Errors(socialPolicySchema, patch)];
			if (errors.length) throw new SocialError("invalid_params", errors.map((e) => e.message).join("; "));
			if (patch.judge && patch.judge.preset !== before.judge?.preset)
				throw new SocialError("forbidden", "Judge must already be configured", { reason: "scope_denied" });
			after = effectivePolicy(disk.social?.defaults?.[kind], {
				...disk.social?.conversations?.[request.conv],
				...patch,
			});
			if ("session" in caller) {
				const fingerprint = revision([
					request.agent,
					request.conv,
					request.expectedRevision,
					request.patch,
					request.reason,
				]);
				if (request.dryRun !== false) {
					if (caller.event?.id) confirmations.set(caller.session, { fingerprint, event: caller.event.id });
				} else {
					const pending = confirmations.get(caller.session);
					confirmations.delete(caller.session);
					const text = (caller.event?.data as { text?: unknown } | undefined)?.text;
					if (
						!pending ||
						pending.fingerprint !== fingerprint ||
						!caller.event?.id ||
						caller.event.id === pending.event ||
						typeof text !== "string" ||
						!/^(确认|confirm)$/i.test(text.trim())
					)
						throw new SocialError("forbidden", "Owner must send 确认 as a separate message after preview", {
							reason: "scope_denied",
						});
				}
			}
			if (request.dryRun !== false) return { before, after, affected: [request.conv], revision: current };
			document.setIn(["social", "conversations", request.conv], {
				...disk.social?.conversations?.[request.conv],
				...patch,
			});
			const candidate = parseAgentConfig(document.toString(), file, request.agent);
			const agents = new Map(options.agents);
			agents.set(request.agent, { ...candidate, bindings: agent.bindings });
			await options.validate(agents);
			const temp = `${file}.${randomUUID()}.tmp`;
			try {
				await writeFile(temp, document.toString(), { flag: "wx", mode: 0o600 });
				await rename(temp, file);
			} finally {
				await rm(temp, { force: true });
			}
			try {
				await options.reload();
			} catch (error) {
				const rollback = `${file}.${randomUUID()}.tmp`;
				try {
					await writeFile(rollback, original, { flag: "wx", mode: 0o600 });
					await rename(rollback, file);
					await options.reload();
				} finally {
					await rm(rollback, { force: true });
				}
				throw error;
			}
			current = revision(candidate.social);
			await options.record({
				type: "social.policy-change",
				from: "plugin:social",
				conv: request.conv,
				data: {
					actor: trustedActor,
					...(sourceEvent ? { sourceEvent } : {}),
					before,
					after,
					reason: request.reason,
					revision: current,
					result: "applied",
				},
			});
			return { before, after, affected: [request.conv], revision: current };
		} catch (error) {
			await options.record({
				type: "social.policy-change",
				from: "plugin:social",
				conv: request.conv,
				data: {
					actor,
					...(sourceEvent ? { sourceEvent } : {}),
					before,
					after,
					reason: request.reason,
					revision: current,
					result: "rejected",
				},
			});
			throw error;
		} finally {
			await unlock?.();
		}
	};
	const auditDenied = async (principal: Principal, params: unknown, reason: "forbidden" | "invalid_params") => {
		const candidate = params && typeof params === "object" ? (params as { conv?: unknown }).conv : undefined;
		const conv =
			typeof candidate === "string" && candidate.length <= 2048 && /^conv:[a-z0-9-]+:\S+$/.test(candidate)
				? candidate
				: undefined;
		await options.record({
			type: "social.policy-change",
			from: "plugin:social",
			...(conv ? { conv } : {}),
			data: { actor: principal.id, before: {}, after: {}, reason, revision: "unknown", result: "rejected" },
		});
	};
	/**
	 * 触发时只记一条结构化提示事件（不含措辞，文案归 O52），下一次回合由事件窗口带给模型；
	 * 模型仍用既有的 mute / 继续机制处理，不新增停止通道。
	 */
	const botGate = async (request: {
		agent: string;
		conv: string;
		events: readonly BotGateEvent[];
		now?: string | number;
	}) => {
		const target = options.agents.get(request.agent);
		if (!target) throw new SocialError("invalid_params", "Unknown agent");
		const result = botGateCounts(request.events, request.now ?? Date.now(), target.social?.botGate);
		if (result.inject && result.hint)
			await options.record({
				type: "social.bot-gate",
				from: "plugin:social",
				conv: request.conv,
				data: { agent: request.agent, source: "bot", weight: "low", ...result.hint },
			});
		return result;
	};
	return { inspect, update, auditDenied, botGate };
}
