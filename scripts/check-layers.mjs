import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// 分层依赖门禁（architecture §6）：core 的模块只能依赖本层或更低层，包括 `import type`。
// 与文件行数门禁一样，基线只减不增：新增上行边失败，基线里已消失的条目必须删掉。
const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "packages/core/src");
const BASELINE_PATH = resolve(ROOT, "scripts/layer-baseline.json");

/**
 * 模块 → 层级。routing 与 delivery 同属 L3，但 routing 在下、delivery 在上（routing → delivery）。
 * 数值只用于比较：越大越高。
 */
export const MODULE_LAYERS = {
	// L0 存储、配置解析与纯谓词
	store: { level: 0, layer: "L0" },
	config: { level: 0, layer: "L0" },
	signals: { level: 0, layer: "L0" },
	status: { level: 0, layer: "L0" },
	// L1 唯一的 pi 适配与叶子工具
	runtime: { level: 1, layer: "L1" },
	permissions: { level: 1, layer: "L1" },
	// L2 会话接口、内核工具、技能、提示词与保留
	sessions: { level: 2, layer: "L2" },
	tools: { level: 2, layer: "L2" },
	skills: { level: 2, layer: "L2" },
	prompt: { level: 2, layer: "L2" },
	retention: { level: 2, layer: "L2" },
	// L3 绑定求值 → 投递
	routing: { level: 3, layer: "L3" },
	delivery: { level: 4, layer: "L3" },
	// L4 组合根
	kernel: { level: 5, layer: "L4" },
	plugins: { level: 5, layer: "L4" },
	views: { level: 5, layer: "L4" },
	control: { level: 5, layer: "L4" },
	release: { level: 5, layer: "L4" },
	imports: { level: 5, layer: "L4" },
	bundles: { level: 5, layer: "L4" },
	index: { level: 5, layer: "L4" },
};

const wantJson = process.argv.includes("--json");

function toPosix(path) {
	return path.split(sep).join("/");
}

/** 递归收集 core 的源文件（不含测试），返回相对仓库根的 posix 路径。 */
function collectSourceFiles(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectSourceFiles(absolute, out);
			continue;
		}
		if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
		if (entry.name.endsWith(".test.ts")) continue;
		out.push(toPosix(relative(ROOT, absolute)));
	}
}

/**
 * 从一份源码里取出所有模块路径：`from "..."`（含 `import type` 与 `export ... from`）、
 * 副作用 import，以及 `import("...")` 里的类型引用。
 */
export function importedSpecifiers(text) {
	const found = new Set();
	const patterns = [
		/\bfrom\s+["']([^"']+)["']/g,
		/(?:^|[\s;])import\s+["']([^"']+)["']/g,
		/\bimport\(\s*["']([^"']+)["']\s*\)/g,
	];
	for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]);
	return [...found];
}

/**
 * 模块名。目录下的文件属于该目录模块；`src/` 根下的文件（permissions.ts、bundles.ts、index.ts）也
 * 按模块名登记在 MODULE_LAYERS 里。
 */
export function moduleOf(file) {
	const segments = toPosix(relative(SRC, resolve(ROOT, file))).split("/");
	return segments.length > 1 ? segments[0] : segments[0].replace(/\.ts$/, "");
}

/** 相对 import 的规范 → 目标文件：先试同名 `.ts`，再试目录下的 `index.ts`。不解析包名。 */
export function resolveSpecifier(fromFile, specifier, exists = (file) => existsSync(file)) {
	if (!specifier.startsWith(".")) return undefined;
	const base = resolve(ROOT, fromFile, "..", specifier).replace(/\.js$/, "");
	if (exists(`${base}.ts`)) return toPosix(`${base}.ts`);
	return toPosix(`${base}/index.ts`);
}

/** 目标文件 → 模块名；相对 core 之外的路径返回 undefined。 */
export function targetModule(target) {
	const relativeToSrc = toPosix(relative(SRC, target));
	if (relativeToSrc.startsWith("..")) return undefined;
	return moduleOf(toPosix(relative(ROOT, target)));
}

/**
 * 一条上行边：`from -> to`。同一对模块合并成一条，附带示例文件，便于定位。
 * `readFile` 与 `exists` 可注入，测试因此无需在仓库里造文件。
 */
export function findViolations(
	files,
	readFile = (file) => readFileSync(resolve(ROOT, file), "utf8"),
	exists = (file) => existsSync(file),
) {
	const violations = new Map();
	for (const file of files) {
		const from = moduleOf(file);
		const fromInfo = MODULE_LAYERS[from];
		if (!fromInfo) throw new Error(`未知模块（请补进 scripts/check-layers.mjs 的层级表）：${file}`);
		for (const specifier of importedSpecifiers(readFile(file))) {
			const target = resolveSpecifier(file, specifier, exists);
			if (!target) continue;
			const to = targetModule(target);
			if (to === undefined) continue;
			const toInfo = MODULE_LAYERS[to];
			if (!toInfo)
				throw new Error(`未知模块（请补进 scripts/check-layers.mjs 的层级表）：${to}（${file} → ${specifier}）`);
			if (toInfo.level <= fromInfo.level) continue;
			const key = `${from} -> ${to}`;
			const existing = violations.get(key);
			if (existing) {
				existing.count += 1;
				if (existing.files.length < 5) existing.files.push(`${file} → ${specifier}`);
			} else {
				violations.set(key, {
					from,
					to,
					fromLayer: fromInfo.layer,
					toLayer: toInfo.layer,
					count: 1,
					files: [`${file} → ${specifier}`],
				});
			}
		}
	}
	return [...violations.values()].sort((a, b) => `${a.from} -> ${a.to}`.localeCompare(`${b.from} -> ${b.to}`));
}

function fail(message) {
	if (wantJson) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
	else console.error(message);
	process.exit(1);
}

function loadBaseline() {
	let raw;
	try {
		raw = readFileSync(BASELINE_PATH, "utf8");
	} catch {
		fail("缺少基线文件：scripts/layer-baseline.json");
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		fail(`基线文件不是合法 JSON：${error.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
		fail('基线文件顶层必须是对象：{ "<from> -> <to>": { "reason": "字符串" } }');
	const baseline = new Map();
	for (const [edge, entry] of Object.entries(parsed)) {
		if (entry === null || typeof entry !== "object") fail(`基线条目格式错误：${edge}，需要 { "reason": "字符串" }`);
		baseline.set(edge, { reason: entry.reason ?? "" });
	}
	return baseline;
}

function main() {
	const baseline = loadBaseline();
	const files = [];
	collectSourceFiles(SRC, files);
	const violations = findViolations(files);

	const added = [];
	const within = [];
	for (const violation of violations) {
		const key = `${violation.from} -> ${violation.to}`;
		if (baseline.has(key)) within.push({ ...violation, reason: baseline.get(key).reason, key });
		else added.push({ ...violation, key });
	}
	const stale = [...baseline]
		.filter(([edge]) => !violations.some((violation) => `${violation.from} -> ${violation.to}` === edge))
		.map(([edge, entry]) => ({ key: edge, reason: entry.reason }))
		.sort((a, b) => a.key.localeCompare(b.key));

	const ok = added.length === 0 && stale.length === 0;

	if (wantJson) {
		console.log(
			JSON.stringify(
				{ ok, scanned: files.length, baselineEntries: within.length + stale.length, added, within, stale },
				null,
				2,
			),
		);
		process.exit(ok ? 0 : 1);
	}

	const out = [];
	out.push("分层依赖检查（architecture §6：只允许依赖本层或更低层，含 import type；基线只减不增）");
	out.push(`扫描 ${files.length} 个 .ts 文件，基线登记 ${within.length + stale.length} 条`);

	if (added.length > 0) {
		out.push("");
		out.push("✗ 新增上行依赖（未登记在基线）：");
		for (const item of added) {
			out.push(`  ${item.from}(${item.fromLayer}) → ${item.to}(${item.toLayer})  ${item.count} 处`);
			for (const file of item.files) out.push(`    ${file}`);
		}
		out.push(
			"  → 把需要的值或类型移到下层，或由上层通过构造参数/回调注入；确需保留则登记到 scripts/layer-baseline.json 并写明理由",
		);
	}

	if (stale.length > 0) {
		out.push("");
		out.push("✗ 基线腐烂（请从 scripts/layer-baseline.json 删除这些条目）：");
		for (const item of stale) out.push(`  ${item.key}  已不存在`);
	}

	if (ok) out.push("", `✓ 通过：没有上行依赖${within.length ? `（基线内 ${within.length} 条）` : ""}`);

	console.log(out.join("\n"));
	process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
