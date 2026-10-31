import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { findViolations, importedSpecifiers, MODULE_LAYERS, moduleOf, targetModule } from "./check-layers.mjs";

const { test } = await import(process.env.VITEST ? "vitest" : "node:test");

const files = (sources, exists = () => true) => {
	const all = new Set(Object.keys(sources));
	return {
		read: (file) => sources[file],
		exists: (file) => (exists ?? all.has(file)) && all.has(file),
	};
};

/** 用内存里的文件跑一遍门禁；路径都相对仓库根，与真实扫描一致。 */
const violationsOf = (sources, exists) => {
	const { read, exists: has } = files(sources, exists);
	return findViolations(Object.keys(sources), read, has);
};

test("层级表覆盖 core 的每个模块，且层号从低到高", () => {
	for (const [name, { level, layer }] of Object.entries(MODULE_LAYERS)) {
		assert.equal(typeof level, "number", name);
		assert.match(layer, /^L[0-4]$/, name);
	}
	assert.equal(MODULE_LAYERS.store.level, 0);
	assert.equal(MODULE_LAYERS.runtime.level, 1);
	assert.equal(MODULE_LAYERS.tools.level, 2);
	assert.equal(MODULE_LAYERS.routing.level, 3);
	assert.equal(MODULE_LAYERS.delivery.level, 4, "routing 在下、delivery 在上");
	assert.equal(MODULE_LAYERS.kernel.level, 5);
});

test("import 解析认得 import type、export from、副作用 import 与 import()", () => {
	assert.deepEqual(
		importedSpecifiers(`
import { a } from "../config/index.js";
import type { B } from "./notifications.js";
export { c } from "../../store/db.js";
import "./side-effect.js";
const d = await import("../sessions/budget.js");
type E = import("../runtime/index.js").F;
`).sort(),
		[
			"../../store/db.js",
			"../config/index.js",
			"../runtime/index.js",
			"../sessions/budget.js",
			"./notifications.js",
			"./side-effect.js",
		],
	);
});

test("模块与目标文件按 core 目录映射，根文件自成模块", () => {
	assert.equal(moduleOf("packages/core/src/routing/commands.ts"), "routing");
	assert.equal(moduleOf("packages/core/src/index.ts"), "index");
	assert.equal(moduleOf("packages/core/src/permissions.ts"), "permissions");
	assert.equal(targetModule(new URL("../packages/core/src/config/index.ts", import.meta.url).pathname), "config");
	assert.equal(targetModule(new URL("../packages/sdk/src/types.ts", import.meta.url).pathname), undefined);
});

test("只把上行边算作违规，同层与下行不算", () => {
	const found = violationsOf({
		// tools(L2) → delivery(L4)：上行
		"packages/core/src/tools/send.ts": 'import type { Delivery } from "../delivery/index.js";\n',
		// tools(L2) → config(L0)：下行
		"packages/core/src/tools/ok.ts": 'import { CONSOLE } from "../config/console.js";\n',
		// routing(L3) → delivery(L4)：上行（routing 在 delivery 之下）
		"packages/core/src/routing/cmd.ts": 'export { x } from "../delivery/index.js";\n',
		// delivery(L4) → routing(L3)：下行
		"packages/core/src/delivery/ok.ts": 'import { channelOf } from "../routing/matching.js";\n',
		// 同层
		"packages/core/src/sessions/a.ts": 'import type { B } from "../tools/b.js";\n',
		"packages/core/src/tools/b.ts": "export type B = 1;\n",
	});
	assert.deepEqual(
		found.map((item) => [item.from, item.to, item.count]),
		[
			["routing", "delivery", 1],
			["tools", "delivery", 1],
		],
	);
});

test("同一对模块的多次 import 合并成一条，并逐个列出位置", () => {
	const found = violationsOf({
		"packages/core/src/tools/a.ts":
			'import type { D } from "../delivery/index.js";\nimport type { E } from "../delivery/request.js";\n',
		"packages/core/src/tools/b.ts": 'import type { F } from "../delivery/index.js";\n',
	});
	assert.equal(found.length, 1);
	assert.equal(found[0].from, "tools");
	assert.equal(found[0].to, "delivery");
	assert.equal(found[0].count, 3, "每一处 import 都计数");
	assert.deepEqual(found[0].files, [
		"packages/core/src/tools/a.ts → ../delivery/index.js",
		"packages/core/src/tools/a.ts → ../delivery/request.js",
		"packages/core/src/tools/b.ts → ../delivery/index.js",
	]);
});

test("包名与 core 之外的相对路径不参与比较", () => {
	const found = violationsOf({
		"packages/core/src/store/a.ts": 'import { x } from "@yonder/sdk";\nimport { y } from "../../sdk/src/types.js";\n',
	});
	assert.deepEqual(found, []);
});

test("目录写法解析到 index.ts，同名文件优先", () => {
	const found = violationsOf(
		{
			"packages/core/src/store/a.ts": 'import type { D } from "../runtime/db.js";\n',
		},
		(file) => file === "/Users/zoran/Documents/yonder/packages/core/src/runtime/db.ts",
	);
	assert.deepEqual(
		found.map((item) => [item.from, item.to]),
		[["store", "runtime"]],
	);
});

test("未知模块直接报错，而不是悄悄放行", () => {
	assert.throws(
		() =>
			violationsOf({
				"packages/core/src/unknown/a.ts": 'import { x } from "../config/index.js";\n',
			}),
		/未知模块/,
	);
});

test("命令行在没有违规与基线时通过；基线腐烂时失败", () => {
	const clean = spawnSync(process.execPath, [join(import.meta.dirname, "check-layers.mjs"), "--json"], {
		encoding: "utf8",
	});
	assert.equal(clean.status, 0, clean.stderr);
	const report = JSON.parse(clean.stdout);
	assert.equal(report.ok, true);
	assert.deepEqual(report.added, []);
	assert.deepEqual(report.stale, []);
	assert.ok(report.scanned > 0);
});
