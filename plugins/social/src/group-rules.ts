import { Script } from "node:vm";
import type { PluginAPI, SocialPolicy, ToolContext, YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { groupEvents } from "./group-history.js";
export interface OwnRules {
	keywords?: string[];
	triggers?: SocialPolicy["triggers"];
	count?: number;
}
interface Revision {
	id: string;
	ownerRevision: string;
	rules: OwnRules;
	before: OwnRules;
}
const testRegex = new Script('new RegExp(pattern,"u").test(text)');
export function ruleMatch(text: string, policy: SocialPolicy, onError?: (pattern: string) => void) {
	const normalized = text.normalize("NFC"),
		value = normalized.slice(0, 2048),
		filter = policy.triggers;
	if (
		!value.trim() ||
		normalized.length < (filter?.minLength ?? 0) ||
		(filter?.maxLength !== undefined && normalized.length > filter.maxLength) ||
		filter?.exclude?.some((s) => value.includes(s.normalize("NFC")))
	)
		return { eligible: false, match: false };
	const keyword = policy.keywords?.some((s) => value.includes(s.normalize("NFC"))) ?? false;
	let regex = false;
	for (const pattern of filter?.regex ?? [])
		try {
			if (testRegex.runInNewContext({ pattern, text: value }, { timeout: 10 })) {
				regex = true;
				break;
			}
		} catch {
			onError?.(pattern);
		}
	return { eligible: true, match: keyword || regex };
}
export function replayRules(material: YEvent[], policy: SocialPolicy) {
	const replay = { messages: 0, eligible: 0, matches: 0, triggered: 0, errors: 0 };
	let count = 0;
	for (const event of material) {
		const d = event.data as { text?: string; senderIsBot?: boolean };
		if (event.type !== "message.in" || d.senderIsBot || !d.text) continue;
		replay.messages++;
		const result = ruleMatch(d.text, policy, () => replay.errors++);
		if (!result.eligible) continue;
		replay.eligible++;
		count++;
		if (result.match) replay.matches++;
		if (result.match || count >= (policy.batch?.count ?? 20)) {
			replay.triggered++;
			count = 0;
		}
	}
	return replay;
}
export function validateRules(rules: OwnRules) {
	if (Object.keys(rules).some((k) => !["keywords", "triggers", "count"].includes(k)))
		throw Error("Only this group's trigger fields may change");
	if (rules.count !== undefined && (!Number.isInteger(rules.count) || rules.count < 1 || rules.count > 100))
		throw Error("Invalid count");
	for (const values of [rules.keywords, rules.triggers?.exclude])
		if (
			values &&
			(!Array.isArray(values) ||
				values.length > 32 ||
				values.some((s) => typeof s !== "string" || s.length < 1 || s.length > 64))
		)
			throw Error("Invalid trigger words");
	const t = rules.triggers;
	if (t) {
		if (Object.keys(t).some((k) => !["regex", "exclude", "minLength", "maxLength"].includes(k)))
			throw Error("Unknown trigger field");
		for (const n of [t.minLength, t.maxLength])
			if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 2048)) throw Error("Invalid trigger length");
		if ((t.minLength ?? 0) > (t.maxLength ?? 2048)) throw Error("Invalid trigger length range");
		if (t.regex && (!Array.isArray(t.regex) || t.regex.length > 16)) throw Error("Too many regex rules");
		for (const pattern of t.regex ?? []) {
			if (typeof pattern !== "string" || pattern.length < 1 || pattern.length > 256)
				throw Error("Invalid regex length");
			new RegExp(pattern, "u");
		}
	}
}
/** Bot-owned trigger overrides are ledger facts. Core admission and owner policy stay authoritative. */
export class GroupRules {
	private readonly versions = new Map<string, Revision>();
	private writes: Promise<unknown> = Promise.resolve();
	constructor(
		private readonly api: PluginAPI,
		private readonly managed: (conv: string) => boolean,
		private readonly seeds: Record<string, OwnRules> = {},
	) {}
	private key(agent: string, conv: string) {
		return `${agent}\0${conv}`;
	}
	async start() {
		for await (const event of groupEvents(this.api, "social.rules-change")) {
			const d = event.data as Revision & { agent?: string; conv?: string; after?: OwnRules };
			if (d.agent && event.conv && d.after)
				this.versions.set(this.key(d.agent, event.conv), {
					id: event.id,
					ownerRevision: d.ownerRevision,
					rules: d.after,
					before: d.before,
				});
		}
	}
	version(agent: string, conv: string, ownerRevision: string) {
		const v = this.versions.get(this.key(agent, conv));
		return v?.ownerRevision === ownerRevision ? v : undefined;
	}
	current(agent: string, conv: string, revision: string) {
		return this.version(agent, conv, revision)?.rules ?? this.seeds[agent] ?? {};
	}
	effective(agent: string, conv: string, base: SocialPolicy, revision: string, own?: OwnRules): SocialPolicy {
		const rules = own ?? this.version(agent, conv, revision)?.rules ?? this.seeds[agent];
		if (!rules) return base;
		return {
			...base,
			keywords: [...new Set([...(base.keywords ?? []), ...(rules.keywords ?? [])])],
			batch: { ...base.batch, count: Math.max(base.batch?.count ?? 1, rules.count ?? base.batch?.count ?? 20) },
			triggers: {
				...base.triggers,
				...rules.triggers,
				exclude: [...new Set([...(base.triggers?.exclude ?? []), ...(rules.triggers?.exclude ?? [])])],
				...(base.triggers?.minLength !== undefined || rules.triggers?.minLength !== undefined
					? { minLength: Math.max(base.triggers?.minLength ?? 0, rules.triggers?.minLength ?? 0) }
					: {}),
				...(base.triggers?.maxLength !== undefined || rules.triggers?.maxLength !== undefined
					? { maxLength: Math.min(base.triggers?.maxLength ?? Infinity, rules.triggers?.maxLength ?? Infinity) }
					: {}),
			},
		};
	}
	update(
		agent: string,
		conv: string,
		request: { rules?: OwnRules; expectedRevision: string; reason: string; rollback?: boolean },
		material: YEvent[] = [],
		inspection?: { policy: SocialPolicy; revision: string },
	) {
		const operation = this.writes.then(() => this.apply(agent, conv, request, material, inspection));
		this.writes = operation.catch(() => {});
		return operation;
	}
	private async apply(
		agent: string,
		conv: string,
		request: { rules?: OwnRules; expectedRevision: string; reason: string; rollback?: boolean },
		material: YEvent[],
		inspection?: { policy: SocialPolicy; revision: string },
	) {
		if (!this.managed(conv) || !request.reason?.trim()) throw Error("Managed current group and reason required");
		const inspected = inspection;
		if (!inspected) throw Error("Authorized rule scope required");
		if (
			(inspected.policy.plugin ?? "social") !== "social" ||
			!["batch", "mention"].includes(inspected.policy.mode ?? "batch")
		)
			throw Error("This participation policy does not allow self tuning");
		const previous = this.version(agent, conv, inspected.revision);
		if (request.expectedRevision !== (previous?.id ?? inspected.revision))
			throw Error("Trigger rules changed; inspect again");
		const rules = request.rollback ? (previous?.before ?? this.seeds[agent] ?? {}) : request.rules;
		if (!rules) throw Error("Rules required");
		validateRules(rules);
		const effective = this.effective(agent, conv, inspected.policy, inspected.revision, rules);
		const replay = replayRules(material, effective);
		if (replay.errors) throw Error("Regex exceeded replay execution budget; old rules retained");
		// No await between revision comparison and append except the append itself; ledger publishes one complete revision.
		if (this.version(agent, conv, inspected.revision)?.id !== previous?.id)
			throw Error("Trigger rules changed; inspect again");
		const fact = await this.api.events.emit({
			type: "social.rules-change",
			from: "plugin:social",
			conv,
			data: {
				agent,
				ownerRevision: inspected.revision,
				before: previous?.rules ?? this.seeds[agent] ?? {},
				after: rules,
				reason: request.reason,
				replay,
				...(request.rollback ? { rollback: previous?.id } : {}),
			},
		});
		this.versions.set(this.key(agent, conv), {
			id: fact.id,
			ownerRevision: inspected.revision,
			rules,
			before: previous?.rules ?? this.seeds[agent] ?? {},
		});
		return { revision: fact.id, rules, effective, replay };
	}
	register(material: (conv: string) => Promise<YEvent[]>) {
		this.api.tools.register({
			name: "social_rules_update",
			description:
				"Inspect or update only your own current group's trigger rules. Cannot change admission, permissions, quiet hours, cooldown or owner policy. Supply expectedRevision and a reason to apply; rollback restores your previous rule version.",
			capabilities: ["read"],
			parameters: Type.Object(
				{
					expectedRevision: Type.Optional(Type.String()),
					reason: Type.Optional(Type.String()),
					rollback: Type.Optional(Type.Boolean()),
					rules: Type.Optional(
						Type.Object(
							{
								keywords: Type.Optional(Type.Array(Type.String())),
								count: Type.Optional(Type.Integer()),
								triggers: Type.Optional(
									Type.Object(
										{
											regex: Type.Optional(Type.Array(Type.String())),
											exclude: Type.Optional(Type.Array(Type.String())),
											minLength: Type.Optional(Type.Integer()),
											maxLength: Type.Optional(Type.Integer()),
										},
										{ additionalProperties: false },
									),
								),
							},
							{ additionalProperties: false },
						),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (args, ctx) => {
				try {
					const scope = await this.scope(ctx);
					const input = args as { rules?: OwnRules; expectedRevision?: string; reason?: string; rollback?: boolean };
					const inspected = await this.api.social!.inspect(scope, ctx);
					const previous = this.version(scope.agent, scope.conv, inspected.revision);
					const data =
						input.rules || input.rollback
							? await this.update(
									scope.agent,
									scope.conv,
									{ ...input, expectedRevision: input.expectedRevision ?? "", reason: input.reason ?? "" },
									await material(scope.conv),
									inspected,
								)
							: {
									revision: previous?.id ?? inspected.revision,
									rules: previous?.rules ?? this.seeds[scope.agent] ?? {},
									base: inspected.policy,
								};
					return { text: JSON.stringify(data) };
				} catch (error) {
					return { text: String(error), isError: true };
				}
			},
		});
	}
	private async scope(ctx: ToolContext) {
		const sources = ctx.events ?? (ctx.event ? [ctx.event] : []);
		const convs = [...new Set(sources.map((e) => e.conv).filter((v): v is string => !!v))];
		const conv = convs[0];
		if (
			!ctx.agent ||
			!conv ||
			convs.length !== 1 ||
			!this.managed(conv) ||
			!sources.some((e) => (e.data as { kind?: string }).kind === "group" || e.type === "social.batch-ready")
		)
			throw Error("A real current group Bot execution is required");
		return { agent: ctx.agent, conv };
	}
}
