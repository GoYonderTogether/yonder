import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, expectTypeOf, test } from "vitest";
import type { BuiltinViewId, Placement, ViewContent, ViewData, ViewDecl, ViewsChangedEv } from "./views.js";

// views 槽协议 golden：形状取自 gateway 的 TypeBox schema（运行时权威），SDK 的 TS 类型在编译期对齐；
// 规则 golden ⊆ 当前：已有类型/字段/枚举值/内容变体不得删除或改类型，不得新增必填字段。
// 只增不删的改动后用 UPDATE_GOLDEN=1 重写 golden。
const GOLDEN = new URL("../golden/views.json", import.meta.url);
// 计算出的路径不进 sdk 的 tsc 工程（gateway/core 依赖 sdk，静态 import 会成环），仅由 vitest 加载源码。
const source = (path: string) => new URL(path, import.meta.url).href;

type Shape =
	| { $ref: string }
	| { enum: (string | number | boolean)[] }
	| { variants: Record<string, Shape> }
	| { required: string[]; properties: Record<string, Shape> }
	| { array: Shape }
	| { record: Shape }
	| { const: unknown }
	| { type: string; pattern?: string };
type Schema = Record<string, unknown> & {
	anyOf?: Schema[];
	properties?: Record<string, Schema>;
	patternProperties?: Record<string, Schema>;
	items?: Schema;
	required?: string[];
};

function normalize(schema: Schema, refs: Map<unknown, string>, top = false): Shape {
	const ref = refs.get(schema);
	if (ref && !top) return { $ref: ref };
	if (schema.anyOf) {
		if (schema.anyOf.every((item) => "const" in item))
			return { enum: schema.anyOf.map((item) => item.const as string).sort() };
		const variants: Record<string, Shape> = {};
		for (const item of schema.anyOf) {
			const tag = item.properties?.type?.const;
			if (typeof tag !== "string") throw new Error("views golden: unsupported union");
			variants[tag] = normalize(item, refs);
		}
		return { variants };
	}
	if ("const" in schema) return { const: schema.const };
	if (schema.patternProperties) {
		const [inner] = Object.values(schema.patternProperties);
		if (!inner) throw new Error("views golden: empty record");
		return { record: normalize(inner, refs) };
	}
	if (schema.properties) {
		const properties: Record<string, Shape> = {};
		for (const key of Object.keys(schema.properties).sort())
			properties[key] = normalize(schema.properties[key] as Schema, refs);
		return { required: [...(schema.required ?? [])].sort(), properties };
	}
	if (schema.type === "array" && schema.items) return { array: normalize(schema.items, refs) };
	const type = typeof schema.type === "string" ? schema.type : "unknown";
	return typeof schema.pattern === "string" ? { type, pattern: schema.pattern } : { type };
}

/** golden ⊆ current; returns every violation path. */
function subset(golden: Shape, current: Shape, path: string, out: string[]): string[] {
	if ("enum" in golden) {
		if (!("enum" in current)) out.push(`${path}: no longer an enum`);
		else for (const value of golden.enum) if (!current.enum.includes(value)) out.push(`${path}: removed ${value}`);
	} else if ("variants" in golden) {
		if (!("variants" in current)) out.push(`${path}: no longer a tagged union`);
		else
			for (const [tag, shape] of Object.entries(golden.variants)) {
				const next = current.variants[tag];
				if (next) subset(shape, next, `${path}<${tag}>`, out);
				else out.push(`${path}: removed variant ${tag}`);
			}
	} else if ("properties" in golden) {
		if (!("properties" in current)) out.push(`${path}: no longer an object`);
		else {
			for (const [key, shape] of Object.entries(golden.properties)) {
				const next = current.properties[key];
				if (next) subset(shape, next, `${path}.${key}`, out);
				else out.push(`${path}: removed field ${key}`);
			}
			for (const key of current.required)
				if (!golden.required.includes(key)) out.push(`${path}: new required field ${key}`);
		}
	} else if ("array" in golden) {
		if ("array" in current) subset(golden.array, current.array, `${path}[]`, out);
		else out.push(`${path}: no longer an array`);
	} else if ("record" in golden) {
		if ("record" in current) subset(golden.record, current.record, `${path}{}`, out);
		else out.push(`${path}: no longer a record`);
	} else if (JSON.stringify(golden) !== JSON.stringify(current))
		out.push(`${path}: ${JSON.stringify(golden)} -> ${JSON.stringify(current)}`);
	return out;
}

async function currentShapes(): Promise<Record<string, Shape>> {
	const views = await import(source("../../gateway/src/protocol/views.ts"));
	const named: Record<string, Schema> = {
		Placement: views.PlacementSchema,
		Scope: views.ScopeSchema,
		BuiltinViewId: views.BuiltinViewIdSchema,
		ViewContent: views.ViewContentSchema,
		ViewDecl: views.ViewDeclSchema,
		ViewData: views.ViewDataSchema,
		ViewsChangedEv: views.ViewsChangedEvSchema,
	};
	const refs = new Map<unknown, string>(Object.entries(named).map(([name, schema]) => [schema, name]));
	return Object.fromEntries(Object.entries(named).map(([name, schema]) => [name, normalize(schema, refs, true)]));
}

// 编译期：SDK 类型的必填/可选字段与枚举值必须被列全，下面的运行期断言再把它们与 gateway schema 对齐。
type Req<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type Opt<T> = Exclude<keyof T, Req<T>>;
type Exact<T, L extends readonly unknown[]> = [T] extends [L[number]] ? ([L[number]] extends [T] ? L : never) : never;
const fields =
	<T>() =>
	<R extends readonly Req<T>[], O extends readonly Opt<T>[]>(
		required: Exact<Req<T>, R>,
		optional: Exact<Opt<T>, O>,
	) => ({
		required: [...required].sort() as string[],
		optional: [...optional].sort() as string[],
	});
const values =
	<T>() =>
	<L extends readonly T[]>(list: Exact<T, L>) =>
		[...list].sort() as string[];
type Variant<K extends ViewContent["type"]> = Extract<ViewContent, { type: K }>;

const sdk = {
	enums: {
		Placement: values<Placement>()(["rail", "floating", "page"] as const),
		Scope: values<NonNullable<ViewDecl["actScope"]>>()(["read", "write", "admin", "owner"] as const),
		BuiltinViewId: values<BuiltinViewId>()([
			"todos",
			"goal",
			"subtasks",
			"attachments",
			"context",
			"background",
			"subagents",
			"wakes",
		] as const),
	},
	objects: {
		ViewDecl: fields<ViewDecl>()(
			["id", "plugin", "title", "placement", "scope"] as const,
			["data", "icon", "order", "actions", "actScope", "needs"] as const,
		),
		ViewData: fields<ViewData>()(["viewId", "rev", "content"] as const, ["badge"] as const),
		ViewsChangedEv: fields<ViewsChangedEv>()(["placement", "ids"] as const, ["badge"] as const),
	},
	variants: {
		markdown: fields<Variant<"markdown">>()(["type", "text"] as const, [] as const),
		list: fields<Variant<"list">>()(["type", "items"] as const, [] as const),
		kv: fields<Variant<"kv">>()(["type", "rows"] as const, [] as const),
		choice: fields<Variant<"choice">>()(["type", "prompt", "options"] as const, ["multi"] as const),
		input: fields<Variant<"input">>()(["type", "prompt"] as const, ["placeholder", "secret"] as const),
		builtin: fields<Variant<"builtin">>()(["type", "id", "payload"] as const, [] as const),
	} satisfies Record<ViewContent["type"], unknown>,
};

const split = (shape: Shape | undefined) => {
	if (!shape || !("properties" in shape)) throw new Error("views golden: expected object shape");
	const keys = Object.keys(shape.properties).sort();
	return { required: shape.required, optional: keys.filter((key) => !shape.required.includes(key)) };
};

test("SDK views types match the gateway TypeBox schema", async () => {
	expectTypeOf<ViewDecl["placement"]>().toEqualTypeOf<Placement>();
	expectTypeOf<ViewsChangedEv["placement"]>().toEqualTypeOf<Placement>();
	expectTypeOf<ViewData["content"]>().toEqualTypeOf<ViewContent>();
	const current = await currentShapes();
	for (const [name, list] of Object.entries(sdk.enums)) expect(current[name], name).toEqual({ enum: list });
	for (const [name, keys] of Object.entries(sdk.objects)) expect(split(current[name]), name).toEqual(keys);
	const content = current.ViewContent;
	if (!content || !("variants" in content)) throw new Error("ViewContent must be a tagged union");
	expect(Object.keys(content.variants).sort()).toEqual(Object.keys(sdk.variants).sort());
	for (const [tag, keys] of Object.entries(sdk.variants)) expect(split(content.variants[tag]), tag).toEqual(keys);
});

test("views protocol keeps every golden shape (golden ⊆ current)", async () => {
	const current = await currentShapes();
	if (process.env.UPDATE_GOLDEN === "1") {
		writeFileSync(GOLDEN, `${JSON.stringify(current, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", fileURLToPath(GOLDEN)]);
	}
	const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Shape>;
	const violations: string[] = [];
	for (const [name, shape] of Object.entries(golden)) {
		const next = current[name];
		if (next) subset(shape, next, name, violations);
		else violations.push(`${name}: removed`);
	}
	expect(violations).toEqual([]);
});

test("builtin views conform to the frozen ViewDecl shape", async () => {
	const { builtinViews } = await import(source("../../core/src/views/builtin.ts"));
	const decl = split((await currentShapes()).ViewDecl);
	const placements = sdk.enums.Placement;
	for (const { decl: view } of builtinViews() as { decl: ViewDecl }[]) {
		expect(
			Object.keys(view).filter((key) => ![...decl.required, ...decl.optional].includes(key)),
			view.id,
		).toEqual([]);
		for (const key of decl.required) expect(view, view.id).toHaveProperty(key);
		expect(placements, view.id).toContain(view.placement);
	}
});
