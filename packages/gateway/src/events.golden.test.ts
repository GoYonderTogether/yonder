import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROTOCOL } from "@yonder/core";
import { describe, expect, it } from "vitest";
import { EVENT_SCHEMAS } from "./protocol/index.js";

/**
 * 事件契约 golden（S-C03）：0.3 冻结事件类型清单与每个事件的必有字段、字段类型。
 *
 * 规则是 golden ⊆ 当前（同 S-C02，不是全等）：
 * 删事件、改名字、删字段、改字段类型、新增必填字段会失败；新增事件类型或新增可选字段不会。
 * 重写基线：`UPDATE_GOLDEN=1 npx vitest run packages/gateway/src/events.golden.test.ts`，
 * 格式化会自动执行。
 */
type Scalar = "string" | "number" | "integer" | "boolean" | "null" | "unknown";
type Shape =
	| Scalar
	| { literal: string | number | boolean | null }
	| { array: Shape }
	| { record: Shape }
	| { union: Shape[] }
	| { object: { required: string[]; fields: Record<string, Shape> } };
type EventEntry = { required: string[]; fields: Record<string, Shape> };
type Golden = { protocol: number; events: Record<string, EventEntry> };

const goldenUrl = new URL("../../protocol/golden/events.json", import.meta.url);
const scalars: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean", "null"]);
/** Type.Unknown() 序列化为 `{}`：契约里就是「不约束」，冻结成一个类型名。 */

/** Typebox schemas are JSON Schema:单层 walk 足够，遇到没见过的节点直接报错而不是静默放过。 */
function shapeOf(node: unknown, path: string): Shape {
	const schema = node as Record<string, unknown>;
	if (Array.isArray(schema.anyOf))
		return { union: dedupe(schema.anyOf.map((branch, index) => shapeOf(branch, `${path}|${index}`))) };
	if (schema.type === "object" && schema.properties !== undefined) return { object: objectOf(schema, path) };
	if (schema.type === "object" && schema.patternProperties !== undefined) {
		const [pattern] = Object.values(schema.patternProperties as Record<string, unknown>);
		return { record: shapeOf(pattern, `${path}{}`) };
	}
	if (schema.type === "array") return { array: shapeOf(schema.items, `${path}[]`) };
	if ("const" in schema) return { literal: schema.const as string | number | boolean | null };
	if (typeof schema.type === "string" && scalars.has(schema.type)) return schema.type as Scalar;
	if (Object.keys(schema).length === 0) return "unknown";
	throw new Error(`events.golden: 未处理的 schema 节点 @ ${path}：${JSON.stringify(schema)}`);
}

function objectOf(schema: Record<string, unknown>, path: string): EventEntry {
	const fields: Record<string, Shape> = {};
	for (const name of Object.keys((schema.properties ?? {}) as Record<string, unknown>).sort()) {
		fields[name] = shapeOf((schema.properties as Record<string, unknown>)[name], `${path}.${name}`);
	}
	return { required: [...((schema.required as string[] | undefined) ?? [])].sort(), fields };
}

/** 顶层是联合类型的事件（activity.summary）按分支合并：必有字段取交集，字段类型取并集。 */
function entryOf(node: unknown, path: string): EventEntry {
	const schema = node as Record<string, unknown>;
	if (!Array.isArray(schema.anyOf)) return objectOf(schema, path);
	const branches = schema.anyOf.map((branch, index) => entryOf(branch, `${path}|${index}`));
	const [first, ...rest] = branches;
	if (first === undefined) throw new Error(`events.golden: ${path} 是空联合类型`);
	const fields: Record<string, Shape> = {};
	const names = [...new Set(branches.flatMap((branch) => Object.keys(branch.fields)))].sort();
	for (const name of names) {
		const sigs = dedupe(branches.flatMap((branch) => (name in branch.fields ? [branch.fields[name] as Shape] : [])));
		const [only] = sigs;
		fields[name] = sigs.length === 1 && only !== undefined ? only : { union: sigs };
	}
	return { required: first.required.filter((name) => rest.every((branch) => branch.required.includes(name))), fields };
}

function dedupe(shapes: Shape[]): Shape[] {
	const seen = new Map<string, Shape>();
	for (const shape of shapes) seen.set(JSON.stringify(shape), shape);
	return [...seen.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, shape]) => shape);
}

function currentGolden(): Golden {
	const events: Record<string, EventEntry> = {};
	for (const [type, schema] of Object.entries(EVENT_SCHEMAS).sort(([a], [b]) => (a < b ? -1 : 1)))
		events[type] = entryOf(schema, type);
	return { protocol: PROTOCOL, events };
}

/** 返回 golden 相对当前契约的破坏项；空数组表示 golden ⊆ 当前。 */
function violations(golden: Shape, current: Shape, path: string, out: string[] = []): string[] {
	if (typeof golden === "string" || typeof current === "string") {
		if (golden !== current) out.push(`${path}: 字段类型 ${JSON.stringify(golden)} → ${JSON.stringify(current)}`);
		return out;
	}
	if ("literal" in golden) {
		if (!("literal" in current) || current.literal !== golden.literal)
			out.push(`${path}: 字面量 ${JSON.stringify(golden.literal)} → ${JSON.stringify(current)}`);
		return out;
	}
	if ("object" in golden) {
		if (!("object" in current)) {
			out.push(`${path}: 不再是对象`);
			return out;
		}
		for (const name of current.object.required)
			if (!golden.object.required.includes(name)) out.push(`${path}: 新增必填字段 ${name}`);
		for (const name of Object.keys(golden.object.fields).sort()) {
			const now = current.object.fields[name];
			if (now === undefined) out.push(`${path}: 字段已删除 ${name}`);
			else violations(golden.object.fields[name] as Shape, now, `${path}.${name}`, out);
		}
		return out;
	}
	if ("array" in golden) {
		if (!("array" in current)) {
			out.push(`${path}: 不再是数组`);
			return out;
		}
		return violations(golden.array, current.array, `${path}[]`, out);
	}
	if ("record" in golden) {
		if (!("record" in current)) {
			out.push(`${path}: 不再是映射`);
			return out;
		}
		return violations(golden.record, current.record, `${path}{}`, out);
	}
	if (!("union" in current)) {
		out.push(`${path}: 不再是联合类型`);
		return out;
	}
	for (const branch of golden.union) {
		if (current.union.some((variant) => violations(branch, variant, path, []).length === 0)) continue;
		out.push(`${path}: 联合类型缺少分支 ${JSON.stringify(branch)}`);
	}
	return out;
}

describe("事件契约 golden (S-C03)", () => {
	it("golden 冻结的事件类型、必有字段与字段类型仍然成立（golden ⊆ 当前）", () => {
		if (process.env.UPDATE_GOLDEN === "1") {
			writeFileSync(goldenUrl, `${JSON.stringify(currentGolden(), null, "\t")}\n`);
			execFileSync("npx", ["biome", "format", "--write", fileURLToPath(goldenUrl)]);
		}
		const golden = JSON.parse(readFileSync(goldenUrl, "utf8")) as Golden;
		expect(golden.protocol).toBe(PROTOCOL);

		const current = currentGolden();
		const broken: string[] = [];
		for (const type of Object.keys(golden.events).sort()) {
			const now = current.events[type];
			const frozen = golden.events[type] as EventEntry;
			if (now === undefined) {
				broken.push(`${type}: 事件类型已删除`);
				continue;
			}
			broken.push(...violations({ object: frozen }, { object: now }, type));
		}
		expect(broken).toEqual([]);
	});
});
