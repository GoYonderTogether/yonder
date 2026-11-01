import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, expectTypeOf, test } from "vitest";
import type {
	Participation,
	ParticipationDecision,
	ParticipationInput,
	ParticipationReason,
	SocialPolicy,
} from "./social.js";

// 参与判定钩子 golden（20 §5）：`Hook.participation`、`ParticipationInput/Decision`、`ParticipationReason`
// 的形状。规则 golden ⊆ 当前：已有字段、必填性、原因值不得删除或改类型，不得新增必填字段；
// `ParticipationReason` 只增不删。只增不删的改动后用 UPDATE_GOLDEN=1 重写 golden。
const GOLDEN = new URL("../golden/participation.json", import.meta.url);

type Shape = { required: string[]; optional: string[] };
interface Golden {
	hook: string;
	objects: Record<string, Shape>;
	/** Enum golden: each listed value must still exist; values may be added. */
	reasons: Record<string, string[]>;
}

type Req<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type Opt<T> = Exclude<keyof T, Req<T>>;
type Exact<T, L extends readonly unknown[]> = [T] extends [L[number]] ? ([L[number]] extends [T] ? L : never) : never;

const fields =
	<T>() =>
	<R extends readonly Req<T>[], O extends readonly Opt<T>[]>(
		required: Exact<Req<T>, R>,
		optional: Exact<Opt<T>, O>,
	) => ({
		required: [...required].sort(),
		optional: [...optional].sort(),
	});
const values =
	<T>() =>
	<L extends readonly T[]>(list: Exact<T, L>) =>
		[...list].sort();

const sdk = {
	objects: {
		ParticipationInput: fields<ParticipationInput>()(
			["agent", "event", "facts", "now"] as const,
			["channel", "person"] as const,
		),
		"ParticipationInput.agent": fields<ParticipationInput["agent"]>()(["id"] as const, ["owner", "social"] as const),
		"ParticipationInput.channel": fields<NonNullable<ParticipationInput["channel"]>>()(
			[] as const,
			["features", "kinds"] as const,
		),
		"ParticipationInput.facts": fields<ParticipationInput["facts"]>()(
			["bound", "custom", "member", "officialDefault"] as const,
			[] as const,
		),
		ParticipationDecision: fields<ParticipationDecision>()(["reason", "revision", "run"] as const, ["policy"] as const),
	} satisfies Record<string, Shape>,
	reasons: {
		ParticipationReason: values<ParticipationReason>()([
			"unsupported-kind",
			"channel-kind-mismatch",
			"denied",
			"not-authorized",
			"quiet",
			"invalid-timezone",
			"mention-conflict",
			"bot-mention",
			"owner-mention",
			"group-owner",
			"everyone",
			"keyword",
			"direct",
			"record",
			"mention",
			"batch",
			"folded",
			"mute",
		] as const),
	},
};

/** golden ⊆ current; returns every violation path. */
function subset(golden: Shape, current: Shape, path: string, out: string[]): string[] {
	for (const key of golden.required) if (!current.required.includes(key)) out.push(`${path}: removed field ${key}`);
	for (const key of golden.optional)
		if (!current.required.includes(key) && !current.optional.includes(key)) out.push(`${path}: removed field ${key}`);
	for (const key of current.required)
		if (!golden.required.includes(key)) out.push(`${path}: new required field ${key}`);
	return out;
}

function current(): Golden {
	const hook = readFileSync(new URL("./types.ts", import.meta.url), "utf8").match(/\bparticipation\?\([^\n]+/)?.[0];
	if (!hook) throw new Error("Hook.participation missing");
	return { hook, objects: sdk.objects, reasons: sdk.reasons };
}

test("participation hook types and the closed reason set stay exact", () => {
	expectTypeOf<ParticipationDecision["reason"]>().toEqualTypeOf<ParticipationReason>();
	expectTypeOf<ParticipationDecision["policy"]>().toEqualTypeOf<SocialPolicy | undefined>();
	expectTypeOf<ParticipationInput["agent"]["social"]>().toEqualTypeOf<ParticipationInput["agent"]["social"]>();
	const participation: Participation = "batch";
	expect(sdk.reasons.ParticipationReason).toContain(participation);
	for (const shape of Object.values(sdk.objects)) expect(shape.required).toEqual([...shape.required].sort());
});

test("participation protocol keeps every golden shape (golden ⊆ current)", () => {
	const now = current();
	if (process.env.UPDATE_GOLDEN === "1") {
		writeFileSync(GOLDEN, `${JSON.stringify(now, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", fileURLToPath(GOLDEN)]);
	}
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
	const violations: string[] = [];
	expect(now.hook).toBe(golden.hook);
	for (const [name, shape] of Object.entries(golden.objects)) {
		const next = now.objects[name];
		if (next) subset(shape, next, name, violations);
		else violations.push(`${name}: removed`);
	}
	for (const reason of golden.reasons.ParticipationReason ?? [])
		if (!now.reasons.ParticipationReason?.includes(reason as ParticipationReason))
			violations.push(`ParticipationReason: removed ${reason}`);
	expect(violations).toEqual([]);
});

test("the Hook type stays exported from types.ts and keeps its shape golden", () => {
	const source = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
	expect(source).toMatch(/export interface Hook\b/);
	expect(source.match(/\bparticipation\?\([^\n]+/)?.[0]).toBe(
		readFileSync(GOLDEN, "utf8").match(/"hook": "([^"]+)"/)?.[1],
	);
});
