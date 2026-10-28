import { createHash } from "node:crypto";
import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { Errors } from "typebox/value";
import type { ModelProfile } from "../runtime/model-profile.js";

const taskTypes = ["plan", "design", "execute", "chore", "review"] as const;
const parameters = Type.Object(
	{
		taskType: Type.Union(taskTypes.map((task) => Type.Literal(task))),
		needContext: Type.Optional(Type.Integer({ minimum: 0 })),
		needTools: Type.Optional(Type.Boolean()),
		needImages: Type.Optional(Type.Boolean()),
		budgetUsd: Type.Optional(Type.Number({ minimum: 0 })),
		prefer: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true })),
	},
	{ additionalProperties: false },
);
type RouteRequest = import("typebox").Static<typeof parameters>;

const price = (profile: ModelProfile): number =>
	profile.cost.input === null || profile.cost.output === null
		? Number.POSITIVE_INFINITY
		: profile.cost.input + profile.cost.output;
const descending = (a: number | null | undefined, b: number | null | undefined): number =>
	a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a;

export function routeModel(profiles: readonly ModelProfile[], input: unknown) {
	const errors = Errors(parameters, input);
	if (errors.length) throw new Error(`Invalid model_route input: ${errors.map((error) => error.message).join("; ")}`);
	const request = input as RouteRequest;
	const hash = createHash("sha256").update(JSON.stringify(profiles)).digest("hex");
	const task = request.taskType;
	const pin = (profile: ModelProfile) =>
		request.prefer?.some((ref) => ref === profile.id || profile.aliases.includes(ref)) ||
		profile.pins.prefer.some((tag) => tag === task || tag === "*");
	const intelligence = (profile: ModelProfile) =>
		profile.scores.intelligence.byTask[task] ?? profile.scores.intelligence.overall;
	const candidates = profiles.filter(
		(profile) =>
			!profile.pins.avoid.some((tag) => tag === task || tag === "*") &&
			(request.needContext === undefined ||
				(profile.catalog.contextWindow !== null && profile.catalog.contextWindow >= request.needContext)) &&
			(!request.needTools || profile.catalog.toolCall === true) &&
			(!request.needImages || profile.catalog.input.includes("image")) &&
			// Token prices alone cannot establish a task budget without token estimates.
			(request.budgetUsd === undefined ||
				(profile.local.samples > 0 && profile.local.avgCost !== null && profile.local.avgCost <= request.budgetUsd)),
	);
	candidates.sort((a, b) => {
		const preferred = Number(pin(b)) - Number(pin(a));
		const preference = descending(a.scores.preference.byTask[task], b.scores.preference.byTask[task]);
		const ability = descending(intelligence(a), intelligence(b));
		const cost = price(a) === price(b) ? 0 : price(a) < price(b) ? -1 : 1;
		return preferred || preference || (task === "chore" ? cost || ability : ability || cost);
	});
	const reason = (profile: ModelProfile) =>
		[
			`task=${task}`,
			...(pin(profile) ? ["preferred"] : []),
			`intelligence=${intelligence(profile) ?? "unknown"}`,
			`input/output USD per million tokens=${profile.cost.input ?? "unknown"}/${profile.cost.output ?? "unknown"}`,
			...(request.budgetUsd === undefined
				? []
				: [`historical average task cost=${profile.local.avgCost}; not a spending cap`]),
			"recommendation only",
		].join("; ");
	const first = candidates[0];
	return {
		model: first?.id ?? null,
		reason: first
			? reason(first)
			: "No catalog model satisfies the constraints; unknown capabilities or task cost cannot satisfy a hard constraint.",
		alternatives: candidates.slice(1).map((profile) => ({ model: profile.id, reason: reason(profile) })),
		catalogHash: hash,
	};
}

export function createModelRouteTool(profiles: (signal: AbortSignal) => Promise<readonly ModelProfile[]>): Tool {
	return {
		name: "model_route",
		description:
			"Recommend available models for a task without switching models or changing state. Chores favor token price; other tasks favor declared intelligence, then price. Unknown data stays unknown. budgetUsd filters by historical average task cost only; without measured task costs no budget recommendation is possible. needTools requires explicitly known support.",
		capabilities: ["read"],
		parameters,
		execute: async (args, ctx) => {
			try {
				ctx.signal.throwIfAborted();
				if (!ctx.capabilities.includes("read")) throw new Error("需要 read 能力。");
				// Validate before consulting credentials or loading the catalog.
				routeModel([], args);
				const catalog = await profiles(ctx.signal);
				ctx.signal.throwIfAborted();
				return { text: JSON.stringify(routeModel(catalog, args)) };
			} catch (error) {
				return { text: error instanceof Error ? error.message : String(error), isError: true };
			}
		},
	};
}
