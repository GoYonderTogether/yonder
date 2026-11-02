import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	findPurityViolations,
	findRuntimeImportViolations,
	findViolations,
	importedSpecifiers,
	MODULE_LAYERS,
	moduleOf,
	targetModule,
} from "./check-layers.mjs";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");

const files = (sources, exists = () => true) => {
	const all = new Set(Object.keys(sources));
	return {
		read: (file) => sources[file],
		exists: (file) => (exists ? exists(file) : all.has(file)),
	};
};

/** 用内存里的文件跑一遍门禁；路径都相对仓库根，与真实扫描一致。 */
const violationsOf = (sources, exists) => {
	const { read, exists: has } = files(sources, exists);
	return findViolations(Object.keys(sources), read, has);
};
const purityOf = (sources, roots) => {
	const files = new Map(Object.entries(sources).map(([file, text]) => [resolve(file), text]));
	return findPurityViolations(
		roots,
		(file) => files.get(resolve(file)),
		(file) => files.has(resolve(file)),
	);
};

test("层级表覆盖 bot-core 的每个模块，且层号从低到高", () => {
	for (const [name, { level, layer }] of Object.entries(MODULE_LAYERS)) {
		assert.equal(typeof level, "number", name);
		assert.match(layer, /^L[0-4]$/, name);
	}
	assert.equal(MODULE_LAYERS.store.level, 0);
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

test("模块与目标文件按 bot-core 目录映射，根文件自成模块", () => {
	assert.equal(moduleOf("packages/bot-core/src/routing/commands.ts"), "routing");
	assert.equal(moduleOf("packages/bot-core/src/index.ts"), "index");
	assert.equal(moduleOf("packages/bot-core/src/permissions.ts"), "permissions");
	assert.equal(
		targetModule(fileURLToPath(new URL("../packages/bot-core/src/config/index.ts", import.meta.url))),
		"config",
	);
	assert.equal(targetModule(fileURLToPath(new URL("../packages/sdk/src/types.ts", import.meta.url))), undefined);
});

test("只把上行边算作违规，同层与下行不算", () => {
	const found = violationsOf({
		// tools(L2) → delivery(L4)：上行
		"packages/bot-core/src/tools/send.ts": 'import type { Delivery } from "../delivery/index.js";\n',
		// tools(L2) → config(L0)：下行
		"packages/bot-core/src/tools/ok.ts": 'import { CONSOLE } from "../config/console.js";\n',
		// routing(L3) → delivery(L4)：上行（routing 在 delivery 之下）
		"packages/bot-core/src/routing/cmd.ts": 'export { x } from "../delivery/index.js";\n',
		// delivery(L4) → routing(L3)：下行
		"packages/bot-core/src/delivery/ok.ts": 'import { channelOf } from "../routing/matching.js";\n',
		// 同层
		"packages/bot-core/src/sessions/a.ts": 'import type { B } from "../tools/b.js";\n',
		"packages/bot-core/src/tools/b.ts": "export type B = 1;\n",
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
		"packages/bot-core/src/tools/a.ts":
			'import type { D } from "../delivery/index.js";\nimport type { E } from "../delivery/request.js";\n',
		"packages/bot-core/src/tools/b.ts": 'import type { F } from "../delivery/index.js";\n',
	});
	assert.equal(found.length, 1);
	assert.equal(found[0].from, "tools");
	assert.equal(found[0].to, "delivery");
	assert.equal(found[0].count, 3, "每一处 import 都计数");
	assert.deepEqual(found[0].files, [
		"packages/bot-core/src/tools/a.ts → ../delivery/index.js",
		"packages/bot-core/src/tools/a.ts → ../delivery/request.js",
		"packages/bot-core/src/tools/b.ts → ../delivery/index.js",
	]);
});

test("外部包名与bot-core之外的相对路径不参与层级比较", () => {
	const found = violationsOf({
		"packages/bot-core/src/store/a.ts":
			'import { x } from "@yonder/sdk";\nimport { y } from "../../sdk/src/types.js";\n',
	});
	assert.deepEqual(found, []);
});

test("目录写法解析到 index.ts，同名文件优先", () => {
	const found = violationsOf(
		{
			"packages/bot-core/src/store/a.ts": 'import type { D } from "../tools/index.js";\n',
		},
		(file) => file.endsWith("/packages/bot-core/src/tools/index.ts"),
	);
	assert.deepEqual(
		found.map((item) => [item.from, item.to]),
		[["store", "tools"]],
	);
});

test("纯边界递归跟随workspace包入口与barrel的宿主绕路", () => {
	const found = purityOf(
		{
			"packages/bot-core/src/tools/a.ts": 'import "@yonder/runtime-adapter";\n',
			"packages/bot-core/src/tools/b.ts": 'import "@yonder/runtime-adapter/node";\n',
			"packages/runtime-adapter/src/index.ts": 'export * from "./node/index.js";\n',
			"packages/runtime-adapter/src/node/index.ts": 'import { readFile } from "node:fs/promises";\n',
		},
		["packages/bot-core/src/tools/a.ts", "packages/bot-core/src/tools/b.ts"],
	);
	assert.deepEqual(
		found.map(({ file, specifier, reason }) => [file, specifier, reason]),
		[
			["packages/bot-core/src/tools/b.ts", "@yonder/runtime-adapter/node", "runtime-adapter 宿主入口"],
			["packages/runtime-adapter/src/index.ts", "./node/index.js", "runtime-adapter 宿主入口"],
		],
	);
});

test("纯边界递归检查SDK workspace包入口的本地依赖", () => {
	const found = purityOf(
		{
			"packages/bot-core/src/tools/a.ts": 'import "@yonder/sdk";\n',
			"packages/sdk/src/index.ts": 'export * from "./types.js";\n',
			"packages/sdk/src/types.ts": 'import type { Stats } from "node:fs/promises";\n',
		},
		["packages/bot-core/src/tools/a.ts"],
	);
	assert.deepEqual(
		found.map(({ file, specifier, reason }) => [file, specifier, reason]),
		[["packages/sdk/src/types.ts", "node:fs/promises", "宿主 Node 模块"]],
	);
});

test("纯边界按workspace exports解析别名，不能用普通子路径隐藏node实现", () => {
	const root = "packages/bot-core/src/tools/a.ts";
	const found = purityOf(
		{
			[root]: 'import { credentials } from "@yonder/runtime-adapter/credentials";',
			"packages/runtime-adapter/package.json": JSON.stringify({
				exports: { "./credentials": { import: "./dist/node/credentials.js" } },
			}),
			"packages/runtime-adapter/src/node/credentials.ts": "export const credentials = {};",
		},
		[root],
	);
	assert.equal(found.length, 1);
	assert.equal(found[0].reason, "runtime-adapter 宿主入口");
});

test("纯边界拒绝SDK testing直接入口和动态宿主模块", () => {
	const found = purityOf(
		{
			"packages/bot-core/src/tools/a.ts":
				'import "@yonder/sdk/testing";\nconst later = import("child_process/promises");\n',
			"packages/bot-core/src/tools/b.ts": 'import "fs/promises";\nconst os = import("node:os/subpath");\n',
			"packages/bot-core/src/tools/c.ts": 'import "../../../sdk/src/node-storage.js";\n',
		},
		["packages/bot-core/src/tools/a.ts", "packages/bot-core/src/tools/b.ts", "packages/bot-core/src/tools/c.ts"],
	);
	assert.deepEqual(
		found.map(({ specifier, reason }) => [specifier, reason]),
		[
			["@yonder/sdk/testing", "SDK 宿主入口"],
			["child_process/promises", "宿主 Node 模块"],
			["fs/promises", "宿主 Node 模块"],
			["node:os/subpath", "宿主 Node 模块"],
			["../../../sdk/src/node-storage.js", "SDK 宿主入口"],
		],
	);
});

test("纯边界识别process访问但忽略文本与允许纯crypto和path", () => {
	assert.deepEqual(
		purityOf(
			{
				"packages/bot-core/src/tools/a.ts":
					'const note = "process.env"; // process.cwd()\nimport "node:path";\nimport "crypto";\n',
			},
			["packages/bot-core/src/tools/a.ts"],
		),
		[],
	);
	assert.deepEqual(
		purityOf({ "packages/bot-core/src/tools/a.ts": "const home = process.env.HOME;\n" }, [
			"packages/bot-core/src/tools/a.ts",
		]),
		[
			{
				file: "packages/bot-core/src/tools/a.ts",
				specifier: "process.*",
				reason: "宿主 process 事实",
			},
		],
	);
});

test("scanner保留模板插值但不把注释、文本、普通对象process当宿主事实", () => {
	const root = "packages/bot-core/src/tools/a.ts";
	for (const text of [
		"const platform = `${process.platform}`;",
		"const nested = `outer ${`inner ${process.env.HOME}`}`;",
		"const platform = globalThis['process'].platform;",
		"function local(process) { return process.platform; }",
	])
		assert.equal(purityOf({ [root]: text }, [root]).length, 1, text);
	for (const text of [
		"// import 'node:fs';\n/* export * from 'node:os'; */ const text = `process.platform`;",
		"const value = params.process.platform;",
		"const pattern = /process.platform/;",
	])
		assert.deepEqual(purityOf({ [root]: text }, [root]), [], text);
	assert.deepEqual(importedSpecifiers("// import 'node:fs'\nconst note = `import('node:os')`;"), []);
});

test("运行包进口只属于adapter，SDK保留精确context桥与type-only，CLI保留原生UI", () => {
	const sources = {
		"packages/runtime-adapter/src/index.ts": "import {Harness} from '@earendil-works/pi-durable';",
		"packages/sdk/src/index.ts": "import {BACKGROUND_CONTEXT, withAbortSignal} from '@earendil-works/chord/context';",
		"packages/sdk/src/types.ts": "import type {Models} from '@earendil-works/pi-ai';",
		"packages/cli/src/ui.ts": "import {CustomEditor,getMarkdownTheme} from '@earendil-works/pi-coding-agent';",
		"packages/bot-core/src/tools/a.ts": "import {Harness} from '@earendil-works/pi-durable';",
		"packages/local-host/src/models.ts": "import {Models} from '@earendil-works/pi-ai';",
		"packages/sdk/src/other.ts": "import {withCancel} from '@earendil-works/chord/context';",
		"packages/cli/src/run.ts": "import {createAgentSession} from '@earendil-works/pi-coding-agent';",
	};
	const violations = findRuntimeImportViolations(Object.keys(sources), (file) => sources[file]);
	assert.deepEqual(
		violations.map(({ file }) => file),
		[
			"packages/bot-core/src/tools/a.ts",
			"packages/local-host/src/models.ts",
			"packages/sdk/src/other.ts",
			"packages/cli/src/run.ts",
		],
	);
	assert.equal(
		findRuntimeImportViolations(
			["packages/sdk/src/index.ts"],
			() => "import {BACKGROUND_CONTEXT,withAbortSignal,withCancel} from '@earendil-works/chord/context';",
		).length,
		1,
	);
});

test("未知模块直接报错，而不是悄悄放行", () => {
	assert.throws(
		() =>
			violationsOf({
				"packages/bot-core/src/unknown/a.ts": 'import { x } from "../config/index.js";\n',
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
