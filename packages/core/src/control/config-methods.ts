import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Type, { type TSchema } from "typebox";
import { Errors } from "typebox/value";
import { parseDocument } from "yaml";
import {
	type AgentConfig,
	ConfigError,
	loadYonderConfig,
	parseAgentConfig,
	parseYonderConfig,
	type YonderConfig,
} from "../config/index.js";
import { socialSchema } from "../config/social-schema.js";
import type { ManagementRequest } from "../kernel/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { type HostCtx, type MethodDef, MethodError } from "./method-types.js";

const text = Type.String({ minLength: 1 });
/** Same shape as schema.ts: a plain integer, or a `K`/`M` string resolved by tokenAmount(). */
const amount = Type.Union([Type.Integer({ minimum: 0 }), Type.String({ pattern: "^[0-9]+(?:\\.[0-9]+)?[KM]$" })]);
/** Same revision scheme as social policies (kernel/social.ts): sha256 over the stable JSON of the exposed view. */
const revisionOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Agent scope whitelist (G-05): model routing, the token limit and the per-Bot social settings. */
const agentPatch = Type.Object(
	{
		model: Type.Optional(text),
		cheap: Type.Optional(text),
		simple: Type.Optional(text),
		limits: Type.Optional(Type.Object({ maxTokens: Type.Optional(Type.Integer({ minimum: 1 })) })),
		social: Type.Optional(socialSchema),
	},
	{ additionalProperties: false },
);
/** Home scope whitelist (S5/S7): default model and the outsider quota keys only; nothing else in yonder.yaml. */
const homePatch = Type.Object(
	{
		model: Type.Optional(text),
		outsiders: Type.Optional(
			Type.Object({
				ownerShareDailyTokens: Type.Optional(amount),
				perPersonDailyTokens: Type.Optional(amount),
				requireLoginForQuota: Type.Optional(Type.Boolean()),
				guestMaxRounds: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000 })),
				guestPerQrDailyTokens: Type.Optional(amount),
				guestPerSourceDailyRounds: Type.Optional(Type.Integer({ minimum: 0 })),
			}),
		),
	},
	{ additionalProperties: false },
);

function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: MethodDef<P> and MethodDef share one runtime shape; the cast only erases the param generic.
	return def as unknown as MethodDef;
}

interface AgentTarget {
	config: YonderConfig;
	file: string;
	agent: AgentConfig;
	profile: string;
	source: string;
}

async function agentTarget(home: string, id: string, profile?: string): Promise<AgentTarget> {
	const config = await loadYonderConfig(home);
	const entry = config.agents?.find((item) => item.id === id);
	if (!entry) throw new MethodError("not_found", `unknown agent: ${id}`);
	const file = join(resolve(home, entry.workspace), "agent.yaml");
	try {
		const source = await readFile(file, "utf8");
		const agent = parseAgentConfig(source, file, id);
		const selected = profile ?? agent.defaultProfile;
		if (!agent.profiles[selected])
			throw new MethodError(
				"not_found",
				`unknown profile: ${id}/${selected}; use yonder agents show ${id} --home <active home> to read existing profile names. config.get/update can target existing profiles only; use agents validate/update to create or change a profile, then read back with agents show and inspect.`,
			);
		return { config, file, agent, profile: selected, source };
	} catch (error) {
		throw configError(error);
	}
}

/** A schema/parse failure is the caller's problem (invalid_params), never a 500. */
function configError(error: unknown): Error {
	if (error instanceof ConfigError) return new MethodError("invalid_params", error.message);
	return error instanceof Error ? error : new Error(String(error));
}

/** Redacted agent view (G-04): model routing, limits and social settings; never a credential or apiKey. */
function agentView(target: AgentTarget) {
	const { agent, config } = target;
	const profile = { ...agent.defaults, ...agent.profiles[target.profile] };
	const view = {
		agent: agent.id,
		profile: target.profile,
		model: profile.model ?? config.defaultModel ?? null,
		cheap: profile.cheap ?? null,
		simple: profile.simple ?? null,
		fallback: profile.fallback ?? null,
		limits: { maxTokens: { ...agent.defaults?.limits, ...profile.limits }.maxTokens ?? null },
		social: agent.social ?? {},
	};
	return { ...view, revision: revisionOf(view) };
}

/** Redacted home view (S5): chains, budget and outsider quotas; provider blocks (and their keys) are omitted. */
function homeView(config: YonderConfig) {
	const outsiders = config.outsiders ?? {};
	const view = {
		models: {
			chain: config.models?.chain ?? [],
			priceCapPerMTokenYuan: config.models?.priceCapPerMTokenYuan ?? null,
		},
		budget: config.budget ?? {},
		outsiders: {
			ownerShareDailyTokens: outsiders.ownerShareDailyTokens ?? null,
			perPersonDailyTokens: outsiders.perPersonDailyTokens ?? null,
			requireLoginForQuota: outsiders.requireLoginForQuota ?? null,
			guestMaxRounds: outsiders.guestMaxRounds ?? null,
			guestPerQrDailyTokens: outsiders.guestPerQrDailyTokens ?? null,
			guestPerSourceDailyRounds: outsiders.guestPerSourceDailyRounds ?? null,
		},
	};
	return { ...view, revision: revisionOf(view) };
}

async function readView(home: string, agent: string, profile?: string) {
	const target = await agentTarget(home, agent, profile);
	return { target, agent: agentView(target), home: homeView(target.config) };
}

/** Atomic replacement: a temporary sibling in the same directory, then rename over the original. */
async function replace(file: string, text: string) {
	const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temp, text, { flag: "wx", mode: 0o600 });
		await rename(temp, file);
	} finally {
		await rm(temp, { force: true });
	}
}

/**
 * Audit `config.change`. The control layer has no store handle of its own, so the event is appended through a
 * short-lived connection to the same state database the daemon keeps open (migrate is a no-op once current).
 */
async function auditChange(ctx: HostCtx, data: Record<string, unknown>) {
	const db = await openDatabase(join(ctx.home, ".yonder", "state.db"));
	try {
		const store = await createStore(db);
		await store.events.record({
			type: "config.change",
			from: "control:config",
			data: { actor: ctx.principal.id, ...data },
		});
	} finally {
		await db.close();
	}
}

function checked(patch: unknown, schema: TSchema, guidance = ""): Record<string, unknown> {
	const errors = Errors(schema, patch ?? {});
	if (errors.length)
		throw new MethodError(
			"invalid_params",
			[errors.map((error) => error.message).join("; "), guidance].filter(Boolean).join(" "),
		);
	if (!Object.keys(patch as Record<string, unknown>).length)
		throw new MethodError("invalid_params", "patch: at least one whitelisted field is required");
	return patch as Record<string, unknown>;
}

/** Agent scope: the same validated, atomic and reloaded write path the management method already uses. */
async function applyAgentPatch(
	ctx: HostCtx,
	id: string,
	selectedProfile: string,
	expectedFileRevision: string,
	patch: Record<string, unknown>,
) {
	const { agent } = await agentTarget(ctx.home, id, selectedProfile);
	const profile = { ...agent.profiles[selectedProfile] };
	if (patch.model !== undefined) profile.model = patch.model as string;
	if (patch.cheap !== undefined) profile.cheap = patch.cheap as string;
	if (patch.simple !== undefined) profile.simple = patch.simple as string;
	const limits = patch.limits as { maxTokens?: number } | undefined;
	if (limits?.maxTokens !== undefined) profile.limits = { ...profile.limits, maxTokens: limits.maxTokens };
	const value: Record<string, unknown> = { profiles: { ...agent.profiles, [selectedProfile]: profile } };
	if (patch.social !== undefined) value.social = { ...(agent.social ?? {}), ...(patch.social as object) };
	try {
		// SAFETY: ManagementRequest is a closed union in kernel/management.ts; the shape here is its agents.update arm.
		await ctx.kernel.management({
			action: "agents.update",
			id,
			expectedFileRevision,
			value,
		} as unknown as ManagementRequest);
	} catch (error) {
		if (error instanceof Error && error.message === "Config changed while updating; retry with config.get") {
			const current = await readView(ctx.home, id, selectedProfile);
			throw new MethodError("conflict", "Config revision changed", { currentRevision: current.agent.revision });
		}
		throw configError(error);
	}
	return { applied: Object.keys(patch), restartRequired: false };
}

/** Home scope: yonder.yaml top-level keys, schema-validated before the file is touched. */
async function applyHomePatch(ctx: HostCtx, patch: Record<string, unknown>) {
	const file = join(ctx.home, "yonder.yaml");
	const original = await readFile(file, "utf8");
	const document = parseDocument(original);
	if (patch.model !== undefined) document.set("defaultModel", patch.model);
	const outsiders = patch.outsiders as Record<string, unknown> | undefined;
	if (outsiders) for (const [key, value] of Object.entries(outsiders)) document.setIn(["outsiders", key], value);
	const candidate = document.toString();
	parseYonderConfig(candidate, file); // throws ConfigError (invalid_params) before any write
	try {
		await replace(file, candidate);
	} catch (error) {
		await replace(file, original).catch(() => {});
		throw error;
	}
	// Non-agent yonder.yaml keys are read by the running kernel at startup, so the daemon picks them up on restart.
	return { applied: Object.keys(patch), restartRequired: true };
}

export const configMethods: MethodDef[] = [
	define({
		name: "config.get",
		scope: "read",
		params: Type.Object({ agent: Type.Optional(text), profile: Type.Optional(text) }),
		since: 1,
		handler: async (params, ctx) => {
			const { agent, home } = await readView(ctx.home, params.agent ?? "main", params.profile);
			return { ...agent, home };
		},
	}),
	define({
		name: "config.update",
		scope: "admin",
		params: Type.Object({
			agent: Type.Optional(text),
			profile: Type.Optional(text),
			scope: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("home")])),
			expectedRevision: text,
			patch: Type.Record(Type.String(), Type.Unknown()),
		}),
		since: 1,
		handler: async (params, ctx) => {
			const id = params.agent ?? "main";
			const scope = params.scope ?? "agent";
			const before = await readView(ctx.home, id, params.profile);
			const current = scope === "home" ? before.home.revision : before.agent.revision;
			if (params.expectedRevision !== current)
				throw new MethodError("conflict", "Config revision changed", { currentRevision: current });
			if (scope === "agent") {
				const managedElsewhere = new Set([
					"workspace",
					"env",
					"profiles",
					"defaultProfile",
					"bindings",
					"tools",
					"plugins",
				]);
				const unsupported = Object.keys(params.patch).filter((key) => managedElsewhere.has(key));
				if (unsupported.length)
					throw new MethodError(
						"invalid_params",
						`config.get/update is a redacted narrow view and cannot write ${unsupported.join(", ")}; workspace/env/profiles/defaultProfile/bindings/tools/plugins require the full Agent management view. Use yonder agents show/validate/update --home <active home>, then read back with agents show and inspect.`,
					);
			}
			const patch = checked(
				params.patch,
				scope === "home" ? homePatch : agentPatch,
				scope === "agent"
					? "config.update only handles model, cheap, simple, limits.maxTokens, and social; use yonder agents show/validate/update to manage other Agent fields."
					: "config.update home scope only handles the default model and outsider quota settings.",
			);
			const result =
				scope === "home"
					? await applyHomePatch(ctx, patch)
					: await applyAgentPatch(
							ctx,
							id,
							before.agent.profile,
							createHash("sha256").update(before.target.source).digest("hex"),
							patch,
						);
			const after = await readView(ctx.home, id, before.agent.profile);
			await auditChange(ctx, {
				scope,
				agent: id,
				fields: result.applied,
				before: scope === "home" ? before.home : before.agent,
				after: scope === "home" ? after.home : after.agent,
				revision: scope === "home" ? after.home.revision : after.agent.revision,
			});
			return {
				scope,
				applied: result.applied,
				restartRequired: result.restartRequired,
				...after.agent,
				home: after.home,
			};
		},
	}),
];
