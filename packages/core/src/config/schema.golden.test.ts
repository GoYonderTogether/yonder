import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { AgentSchema, PresetSchema, YonderSchema } from "./schema.js";

type Schema = {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	required?: string[];
	properties?: Record<string, Schema>;
	patternProperties?: Record<string, Schema>;
	items?: Schema;
	anyOf?: Schema[];
};

function compatible(previous: Schema, current: Schema): boolean {
	if (previous.type !== current.type || ("const" in previous && previous.const !== current.const)) return false;
	if (previous.enum && (!current.enum || previous.enum.some((value) => !current.enum?.includes(value)))) return false;
	if (current.required?.some((name) => !previous.required?.includes(name))) return false;
	for (const key of ["properties", "patternProperties"] as const) {
		for (const [name, schema] of Object.entries(previous[key] ?? {})) {
			const next =
				current[key]?.[name] ??
				(key === "patternProperties" && name === "^conv:.+" ? current[key]?.["^.+$"] : undefined);
			if (!next || !compatible(schema, next)) return false;
		}
	}
	if (previous.items && (!current.items || !compatible(previous.items, current.items))) return false;
	if (
		previous.anyOf &&
		(!current.anyOf || previous.anyOf.some((schema) => !current.anyOf?.some((next) => compatible(schema, next))))
	)
		return false;
	return true;
}

const golden = JSON.parse(readFileSync(new URL("./schema.golden.json", import.meta.url), "utf8")) as Record<
	string,
	Schema
>;
const schemas = JSON.parse(JSON.stringify({ AgentSchema, PresetSchema, YonderSchema })) as Record<string, Schema>;

test.each(Object.keys(schemas))("%s does not narrow its golden schema", (name) => {
	const previous = golden[name];
	const current = schemas[name];
	expect(previous && current && compatible(previous, current)).toBe(true);
});

test("updates the golden schema only after compatibility is verified", () => {
	expect(Object.entries(schemas).every(([name, schema]) => golden[name] && compatible(golden[name], schema))).toBe(
		true,
	);
	if (process.env.UPDATE_GOLDEN === "1") {
		const path = new URL("./schema.golden.json", import.meta.url);
		writeFileSync(path, `${JSON.stringify(schemas, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", fileURLToPath(path)]);
	}
});

test("compatibility detects narrowing and permits optional fields and enum additions", () => {
	const original: Schema = { type: "object", properties: { mode: { anyOf: [{ const: "a" }, { const: "b" }] } } };
	expect(compatible(original, { ...original, required: ["mode"] })).toBe(false);
	expect(compatible(original, { ...original, properties: { mode: { type: "string" } } })).toBe(false);
	expect(compatible(original, { ...original, properties: { mode: { anyOf: [{ const: "a" }] } } })).toBe(false);
	expect(compatible(original, { ...original, properties: { ...original.properties, extra: { type: "string" } } })).toBe(
		true,
	);
	expect(
		compatible(original, {
			...original,
			properties: { mode: { anyOf: [{ const: "b" }, { const: "a" }, { const: "c" }] } },
		}),
	).toBe(true);
});
