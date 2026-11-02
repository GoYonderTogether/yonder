import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

// 分层依赖门禁（architecture §6）：bot-core 的模块只能依赖本层或更低层，包括 `import type`。
// 与文件行数门禁一样，基线只减不增：新增上行边失败，基线里已消失的条目必须删掉。
const ROOT = resolve(import.meta.dirname, "..");
const SRC = resolve(ROOT, "packages/bot-core/src");
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
	// L1 叶子权限；pi 适配位于独立 runtime-adapter 包。
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
	index: { level: 5, layer: "L4" },
};

const wantJson = process.argv.includes("--json");

function toPosix(path) {
	return path.split(sep).join("/");
}

/** 递归收集 bot-core 的源文件（不含测试），返回相对仓库根的 posix 路径。 */
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
/** TypeScript's scanner preserves template expressions while excluding comments and literal text. */
function tokensOf(text) {
	const scanner = createScanner(true, undefined, text),
		tokens = [],
		templates = [];
	let previous;
	for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
		if (
			kind === SyntaxKind.SlashToken &&
			(!previous || ["=", "(", "[", ",", ":", "=>", "return", "??", "||", "&&", "!", "?"].includes(previous.text))
		)
			kind = scanner.reScanSlashToken();
		if (kind === SyntaxKind.TemplateHead) templates.push(0);
		else if (kind === SyntaxKind.OpenBraceToken && templates.length) templates[templates.length - 1]++;
		else if (kind === SyntaxKind.CloseBraceToken && templates.length) {
			if (templates.at(-1) === 0) {
				kind = scanner.reScanTemplateToken(false);
				if (kind === SyntaxKind.TemplateTail) templates.pop();
			} else templates[templates.length - 1]--;
		}
		previous = { kind, text: scanner.getTokenText(), value: scanner.getTokenValue() };
		tokens.push(previous);
	}
	return tokens;
}
function moduleReferences(text) {
	const tokens = tokensOf(text),
		refs = [];
	const literal = (token) =>
		token && [SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral].includes(token.kind);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];

		if (token.kind !== SyntaxKind.ImportKeyword && token.kind !== SyntaxKind.ExportKeyword) continue;
		const next = tokens[i + 1];
		if (token.kind === SyntaxKind.ImportKeyword && next?.text === "(") {
			if (literal(tokens[i + 2])) refs.push({ specifier: tokens[i + 2].value, typeOnly: false, names: [] });
			continue;
		}
		if (next?.text === ".") continue;
		if (token.kind === SyntaxKind.ImportKeyword && literal(next)) {
			refs.push({ specifier: next.value, typeOnly: false, names: [] });
			continue;
		}
		const clause = [];
		for (let j = i + 1; j < tokens.length; j++) {
			const current = tokens[j];
			if (
				current.text === ";" ||
				current.kind === SyntaxKind.ImportKeyword ||
				current.kind === SyntaxKind.ExportKeyword
			)
				break;
			if (current.text === "from" && literal(tokens[j + 1])) {
				const segments = clause
					.filter((t) => !["{", "}"].includes(t.text))
					.map((t) => t.text)
					.join(" ")
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean);
				const names = segments.map((part) => part.replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
				refs.push({
					specifier: tokens[j + 1].value,
					typeOnly: clause[0]?.text === "type" || segments.every((part) => part.startsWith("type ")),
					names,
				});
				break;
			}
			clause.push(current);
		}
	}
	return refs;
}
export function importedSpecifiers(text) {
	return [...new Set(moduleReferences(text).map(({ specifier }) => specifier))];
}
function readsHostProcess(text) {
	const tokens = tokensOf(text);
	// `process` is reserved in shared source; member names such as request.process are ordinary data.
	return tokens.some((token, index) => {
		const previous = tokens[index - 1]?.text,
			next = tokens[index + 1]?.text;
		if (token.text === "process" && ![".", "?."].includes(previous) && [".", "?.", "["].includes(next)) return true;
		return (
			token.text === "globalThis" &&
			((next === "." && tokens[index + 2]?.text === "process") ||
				(next === "[" && tokens[index + 2]?.value === "process"))
		);
	});
}

/**
 * 模块名。目录下的文件属于该目录模块；`src/` 根下的文件（permissions.ts、index.ts）也
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

const WORKSPACE_PACKAGES = {
	"@yonder/bot-definition": "bot-definition",
	"@yonder/bot-core": "bot-core",
	"@yonder/sdk": "sdk",
	"@yonder/runtime-adapter": "runtime-adapter",
	"@yonder/local-host": "local-host",
	"@yonder/core": "core",
};

function packageTarget(specifier, exists = existsSync, readMetadata = (file) => readFileSync(file, "utf8")) {
	for (const [name, directory] of Object.entries(WORKSPACE_PACKAGES)) {
		if (specifier !== name && !specifier.startsWith(`${name}/`)) continue;
		const manifest = resolve(ROOT, `packages/${directory}/package.json`);
		if (exists(manifest)) {
			const text = readMetadata(manifest);
			const exports = text === undefined ? undefined : JSON.parse(text).exports;
			const key = "." + specifier.slice(name.length);
			let entry = exports?.[key];
			if (!entry) {
				for (const [pattern, value] of Object.entries(exports ?? {})) {
					if (!pattern.includes("*")) continue;
					const [before, after] = pattern.split("*");
					if (key.startsWith(before) && key.endsWith(after)) {
						const match = key.slice(before.length, after ? -after.length : undefined);
						const target = typeof value === "string" ? value : (value.import ?? value.default ?? value.types);
						entry = target?.replaceAll("*", match);
						break;
					}
				}
			}
			const output = typeof entry === "string" ? entry : (entry?.import ?? entry?.default ?? entry?.types);
			if (output?.startsWith("./dist/")) {
				const target = resolve(ROOT, `packages/${directory}/src`, output.slice(7).replace(/\.d\.ts$|\.js$/, ".ts"));
				if (exists(target)) return target;
			}
		}
		const subpath = (specifier.slice(name.length).replace(/^\//, "") || "index").replace(/\.js$/, "");
		const base = resolve(ROOT, `packages/${directory}/src`, subpath);
		for (const candidate of [`${base}.ts`, `${base}/index.ts`]) if (exists(candidate)) return candidate;
		return undefined;
	}
	return undefined;
}

function forbiddenModule(specifier) {
	if (/^(?:node:)?(?:fs|child_process|os|process)(?:\/|$)/.test(specifier)) return "宿主 Node 模块";
	if (specifier === "@yonder/local-host" || specifier.startsWith("@yonder/local-host/")) return "local-host";
	if (specifier === "@yonder/core" || specifier.startsWith("@yonder/core/")) return "旧 core 兼容门面";
	if (/^@yonder\/sdk\/(?:testing|node-storage)(?:\/|$)/.test(specifier)) return "SDK 宿主入口";
	if (/^@yonder\/runtime-adapter\/(?:node|postgres)(?:\/|$)/.test(specifier)) return "runtime-adapter 宿主入口";
	return undefined;
}

function forbiddenTarget(target) {
	const path = toPosix(relative(ROOT, target));
	if (path.startsWith("packages/local-host/")) return "local-host";
	if (path.startsWith("packages/core/")) return "旧 core 兼容门面";
	if (/^packages\/sdk\/src\/(?:testing(?:\/|\.ts)|node-storage(?:\/|\.ts))/.test(path)) return "SDK 宿主入口";
	if (/^packages\/runtime-adapter\/src\/(?:node|postgres)(?:\/|$)/.test(path)) return "runtime-adapter 宿主入口";
	return undefined;
}

const CLI_UI_NAMES = new Set([
	"AssistantMessageComponent",
	"CustomMessageComponent",
	"getMarkdownTheme",
	"keyText",
	"UserMessageComponent",
	"ToolExecutionComponent",
	"CustomEditor",
	"copyToClipboard",
	"ExtensionSelectorComponent",
	"SessionSelectorComponent",
	"Theme",
	"initTheme",
]);
/** Enforce the one runtime import owner, retaining the SDK context bridge and native CLI UI. */
export function findRuntimeImportViolations(files, readFile = (file) => readFileSync(resolve(ROOT, file), "utf8")) {
	const violations = [];
	for (const file of files) {
		const path = toPosix(relative(ROOT, resolve(ROOT, file)));
		if (path.startsWith("packages/runtime-adapter/")) continue;
		for (const ref of moduleReferences(readFile(file))) {
			if (!/^@earendil-works\/(?:chord|pi-ai|pi-durable|pi-env|pi-coding-agent|pi-tui)(?:\/|$)/.test(ref.specifier))
				continue;
			if (path.startsWith("packages/sdk/") && ref.typeOnly) continue;
			if (
				path === "packages/sdk/src/index.ts" &&
				ref.specifier === "@earendil-works/chord/context" &&
				ref.names.length === 2 &&
				new Set(ref.names).size === 2 &&
				ref.names.every((name) => ["BACKGROUND_CONTEXT", "withAbortSignal"].includes(name))
			)
				continue;
			if (
				path.startsWith("packages/cli/") &&
				(ref.specifier === "@earendil-works/pi-tui" ||
					(ref.specifier === "@earendil-works/pi-coding-agent" &&
						ref.names.length > 0 &&
						ref.names.every((name) => CLI_UI_NAMES.has(name))))
			)
				continue;
			violations.push({ file: path, specifier: ref.specifier, reason: "运行包只允许 runtime-adapter import" });
		}
	}
	return violations;
}

/** Recursively check pure workspace roots, following both relative and package-barrel imports. */
export function findPurityViolations(roots, readFile = (file) => readFileSync(file, "utf8"), exists = existsSync) {
	const violations = [];
	const visited = new Set();
	const pending = roots.map((file) => resolve(ROOT, file));
	while (pending.length) {
		const file = pending.pop();
		if (visited.has(file) || !exists(file)) continue;
		visited.add(file);
		const source = readFile(file);
		if (readsHostProcess(source))
			violations.push({ file: toPosix(relative(ROOT, file)), specifier: "process.*", reason: "宿主 process 事实" });
		for (const specifier of importedSpecifiers(source)) {
			const reason = forbiddenModule(specifier);
			if (reason) {
				violations.push({ file: toPosix(relative(ROOT, file)), specifier, reason });
				continue;
			}
			const relativeTarget = specifier.startsWith(".") ? resolveSpecifier(file, specifier, exists) : undefined;
			const target = relativeTarget ? resolve(ROOT, relativeTarget) : packageTarget(specifier, exists, readFile);
			if (!target) continue;
			const targetReason = forbiddenTarget(target);
			if (targetReason) {
				violations.push({ file: toPosix(relative(ROOT, file)), specifier, reason: targetReason });
				continue;
			}
			pending.push(target);
		}
	}
	return violations.sort((a, b) => `${a.file} ${a.specifier}`.localeCompare(`${b.file} ${b.specifier}`));
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
			const relativeTarget = specifier.startsWith(".") ? resolveSpecifier(file, specifier, exists) : undefined;
			const target = relativeTarget
				? resolve(ROOT, relativeTarget)
				: packageTarget(specifier, exists, (file) => readFile(toPosix(relative(ROOT, file))));
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
	const purityRoots = [...files];
	collectSourceFiles(resolve(ROOT, "packages/bot-definition/src"), purityRoots);
	purityRoots.push(
		"packages/sdk/src/index.ts",
		"packages/sdk/src/registrations.ts",
		"packages/runtime-adapter/src/index.ts",
	);
	const production = [];
	for (const workspace of JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).workspaces) {
		if (workspace === "packages/pi-durable") continue;
		collectSourceFiles(resolve(ROOT, workspace, "src"), production);
	}
	const purity = [...findPurityViolations(purityRoots), ...findRuntimeImportViolations(production)];

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

	const ok = added.length === 0 && stale.length === 0 && purity.length === 0;

	if (wantJson) {
		console.log(
			JSON.stringify(
				{ ok, scanned: files.length, baselineEntries: within.length + stale.length, added, within, stale, purity },
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

	if (purity.length > 0) {
		out.push("");
		out.push("✗ 纯包触达宿主能力：");
		for (const item of purity) out.push(`  ${item.file} → ${item.specifier}  ${item.reason}`);
	}

	if (ok) out.push("", `✓ 通过：没有上行依赖${within.length ? `（基线内 ${within.length} 条）` : ""}`);

	console.log(out.join("\n"));
	process.exit(ok ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
