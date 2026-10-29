import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isUserInput } from "./review-helpers.mjs";

// Preset defaults for the independent sub-switches. A scope field always overrides its preset.
export const PRESETS = {
	assistant: { memory: true, user: true },
	persona: { memory: true, user: true, skillsPending: true },
	worker: { memory: true, user: false },
};
const RANK = { public: 0, group: 1, owner: 2 };

// Switches of one scope. `memory`/`user`/`review.*`/`refine` fall back to the preset, then true.
export function effective(scope) {
	const preset = PRESETS[scope.preset ?? "assistant"] ?? PRESETS.assistant,
		review = scope.review ?? {};
	const memory = scope.memory ?? preset.memory,
		user = scope.user ?? preset.user;
	return {
		memory,
		user,
		reviewMemory: review.memory ?? true,
		reviewSkills: review.skills ?? true,
		refine: scope.refine ?? true,
		skillsWrite: true,
		note: null,
	};
}
// Narrow a scope's switches to what the conversation's trust allows (never widens).
//  owner  : unchanged.
//  group  : no USER profile, memory only about the group/project, foreground skill writes refused.
//  public : no memory, no profile, no review, no /refine, no skill writes (memory is NOT isolated per
//           counterpart; it is simply not written or shown).
export function limit(eff, trust) {
	if (trust === "owner") return { ...eff, trust };
	if (trust === "group")
		return {
			...eff,
			trust,
			user: false,
			skillsWrite: false,
			note: "This is a group or non-owner conversation: save only facts about the group or its shared project, nothing about individual non-owner people.",
		};
	return {
		...eff,
		trust,
		memory: false,
		user: false,
		reviewMemory: false,
		reviewSkills: false,
		refine: false,
		skillsWrite: false,
	};
}
async function eventTrust(api, agent, e) {
	// Agent-internal and non-user inputs add no external risk.
	if (!isUserInput(e)) return "owner";
	const kind = e.data?.kind;
	let relation = "stranger";
	try {
		relation = (await api.identity?.relation(agent, e.from)) ?? "stranger";
	} catch {}
	if (relation === "owner" && (kind === undefined || kind === "dm")) return "owner";
	if (relation !== "stranger" && (kind === undefined || kind === "dm" || kind === "group")) return "group";
	return "public";
}
// Lowest trust among the run's user inputs; existing owner/known/stranger relation, no new identity model.
export async function trustOf(api, agent, events) {
	let trust = "owner";
	for (const e of events ?? []) {
		const t = await eventTrust(api, agent, e);
		if (RANK[t] < RANK[trust]) trust = t;
	}
	return trust;
}
export const eventsOf = (ctx) => ctx.events ?? (ctx.event ? [ctx.event] : []);

// Plugin data lives at <home>/.yonder/plugins/<id>; the convention scope hangs off <home>/agents/<id>.
export function homeOf(dataPath, id) {
	if (!dataPath) return null;
	const data = resolve(dataPath);
	return basename(data) === id &&
		basename(dirname(data)) === "plugins" &&
		basename(dirname(dirname(data))) === ".yonder"
		? dirname(dirname(dirname(data)))
		: null;
}
const SWITCHES = ["preset", "memory", "user", "review", "refine"];
// Convention scope for an agent without an explicit scope; null when learning is switched off for it.
export function conventionScope(home, agent, config) {
	const own = config.agents?.[agent] ?? {};
	if (own.learning === false || own.enabled === false) return null;
	const root = join(home, "agents", agent);
	return {
		agent,
		profiles: [],
		memoryDir: join(root, "memories"),
		skillDir: join(root, "skills"),
		learning: true,
		writeMode: "exclusive-yonder",
		...Object.fromEntries(SWITCHES.filter((k) => own[k] !== undefined).map((k) => [k, own[k]])),
	};
}
export async function ensureDirs(scope) {
	await mkdir(scope.memoryDir, { recursive: true });
	await mkdir(scope.skillDir, { recursive: true });
}
