import { readFileSync } from "node:fs";
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
			if (!current[key]?.[name] || !compatible(schema, current[key][name])) return false;
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
