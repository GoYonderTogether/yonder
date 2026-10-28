import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { PROTOCOL, registry } from "./methods.js";

// Control-plane method golden (contracts.md §5: protocol=1, add-only).
// Regenerate with `UPDATE_GOLDEN=1 npx vitest run packages/core/src/control/registry.golden.test.ts`,
// formatting runs automatically.
const goldenPath = fileURLToPath(new URL("../../../protocol/golden/methods.json", import.meta.url));

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };
interface MethodEntry {
	scope: string;
	since: number;
	deprecated?: Json;
	paramsSchema: Schema;
}
interface Golden {
	protocol: number;
	methods: Record<string, MethodEntry>;
}

/** Deterministic JSON: object keys sorted recursively; TypeBox symbol metadata is dropped by JSON.stringify. */
function sorted(value: unknown): Json {
	const json = JSON.parse(JSON.stringify(value)) as Json;
	const walk = (node: Json): Json => {
		if (Array.isArray(node)) return node.map(walk);
		if (node && typeof node === "object")
			return Object.fromEntries(
				Object.keys(node)
					.sort()
					.map((key) => [key, walk(node[key] as Json)]),
			);
		return node;
	};
	return walk(json);
}

function current(): Golden {
	const methods: Record<string, MethodEntry> = {};
	for (const def of [...registry.list()].sort((a, b) => a.name.localeCompare(b.name))) {
		const deprecated = (def as { deprecated?: unknown }).deprecated;
		methods[def.name] = {
			scope: def.scope,
			since: def.since,
			...(deprecated === undefined ? {} : { deprecated: sorted(deprecated) }),
			paramsSchema: sorted(def.params) as Schema,
		};
	}
	return { protocol: PROTOCOL, methods };
}

const asSchema = (value: Json | undefined): Schema | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
const requiredOf = (schema: Schema): string[] =>
	Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];

/**
 * Backward-compatibility of a params schema: `golden ⊆ current`.
 * Objects: no new required keys, every golden property still present and compatible; new optional properties allowed.
 * Arrays: items compatible. Anything else (primitive types, literals, unions) must be unchanged.
 */
function incompatibilities(golden: Schema, now: Schema, path: string): string[] {
	if (golden.type === "object" && asSchema(golden.properties)) {
		if (now.type !== "object") return [`${path}: type changed from object to ${JSON.stringify(now.type)}`];
		const problems = requiredOf(now)
			.filter((key) => !requiredOf(golden).includes(key))
			.map((key) => `${path}.${key}: became required`);
		const goldenProps = asSchema(golden.properties) ?? {};
		const nowProps = asSchema(now.properties) ?? {};
		for (const key of Object.keys(goldenProps)) {
			const before = asSchema(goldenProps[key]);
			const after = asSchema(nowProps[key]);
			if (!after) problems.push(`${path}.${key}: property removed`);
			else if (before) problems.push(...incompatibilities(before, after, `${path}.${key}`));
		}
		return problems;
	}
	if (golden.type === "array" && asSchema(golden.items)) {
		if (now.type !== "array") return [`${path}: type changed from array to ${JSON.stringify(now.type)}`];
		const items = asSchema(now.items);
		return items ? incompatibilities(asSchema(golden.items) ?? {}, items, `${path}[]`) : [`${path}[]: items removed`];
	}
	return JSON.stringify(sorted(golden)) === JSON.stringify(sorted(now))
		? []
		: [`${path}: type changed from ${JSON.stringify(golden)} to ${JSON.stringify(now)}`];
}

function diff(golden: Golden, now: Golden): string[] {
	const problems: string[] = [];
	if (golden.protocol !== now.protocol) problems.push(`protocol changed from ${golden.protocol} to ${now.protocol}`);
	for (const [name, before] of Object.entries(golden.methods)) {
		const after = now.methods[name];
		if (!after) {
			problems.push(`${name}: method removed or renamed`);
			continue;
		}
		if (after.scope !== before.scope) problems.push(`${name}: scope changed from ${before.scope} to ${after.scope}`);
		if (after.since !== before.since) problems.push(`${name}: since changed from ${before.since} to ${after.since}`);
		problems.push(...incompatibilities(before.paramsSchema, after.paramsSchema, `${name} params`));
	}
	return problems;
}

test("control method registry stays backward compatible with the golden (golden ⊆ current)", () => {
	const now = current();
	if (process.env.UPDATE_GOLDEN === "1") {
		mkdirSync(dirname(goldenPath), { recursive: true });
		writeFileSync(goldenPath, `${JSON.stringify(now, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", goldenPath]);
	}
	const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Golden;
	expect(diff(golden, now)).toEqual([]);
});

test("golden protocol matches what capabilities.get reports", () => {
	const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Golden;
	expect(golden.protocol).toBe(PROTOCOL);
});

test("compatibility rules: additions pass, removals and tightening fail", () => {
	const base: Golden = {
		protocol: 1,
		methods: {
			"a.get": {
				scope: "read",
				since: 1,
				paramsSchema: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string" }, mode: { type: "string" } },
				},
			},
		},
	};
	const variant = (edit: (copy: Golden) => void): Golden => {
		const copy = structuredClone(base);
		edit(copy);
		return copy;
	};
	const method = (copy: Golden) => copy.methods["a.get"] as MethodEntry;
	const props = (copy: Golden) => method(copy).paramsSchema.properties as Schema;
	expect(diff(base, base)).toEqual([]);
	expect(
		diff(
			base,
			variant((c) => {
				c.methods["b.new"] = { scope: "write", since: 2, paramsSchema: { type: "object", properties: {} } };
				props(c).extra = { type: "boolean" };
			}),
		),
	).toEqual([]);
	expect(
		diff(
			base,
			variant((c) => delete c.methods["a.get"]),
		),
	).toEqual(["a.get: method removed or renamed"]);
	expect(
		diff(
			base,
			variant((c) => (method(c).scope = "admin")),
		),
	).toHaveLength(1);
	expect(
		diff(
			base,
			variant((c) => (method(c).since = 2)),
		),
	).toHaveLength(1);
	expect(
		diff(
			base,
			variant((c) => (method(c).paramsSchema.required = ["id", "mode"])),
		),
	).toEqual(["a.get params.mode: became required"]);
	expect(
		diff(
			base,
			variant((c) => (props(c).id = { type: "number" })),
		),
	).toHaveLength(1);
	expect(
		diff(
			base,
			variant((c) => delete props(c).mode),
		),
	).toEqual(["a.get params.mode: property removed"]);
});
