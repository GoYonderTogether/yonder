import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// dist 被 .gitignore 忽略，`tsc -b` 又是增量的：dist 里的 tsbuildinfo 认为工程已是最新时，
// 缺文件、旧文件都不会被重新产出（BE-11：dist/tools/model-route.js 少了 modelChainRefs，
// dist/runtime/model-chain-config.js 照旧 import 它，doctor 直接抛 SyntaxError）。
// 这个门禁把「dist 与 src 是否一致」变成一次可失败的检查，接在 build 里，也能单独跑。
const ROOT = resolve(import.meta.dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".build", ".yonder", "target"]);
// 第三方 vendored 源码不受本仓库规约约束，也不由根 tsconfig 构建
const SKIP_PREFIXES = ["packages/pi-durable/"];
const REPAIR = "npm run build:clean";

const toPosix = (path) => path.split(sep).join("/");

/** 由根 tsconfig 的 project references 决定的 tsc 构建集合：src 与 dist 一一对应。 */
function projectDirs() {
	const root = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf8"));
	return (root.references ?? [])
		.map((reference) => reference.path)
		.filter((path) => !SKIP_PREFIXES.some((prefix) => `${path}/`.startsWith(prefix)));
}

function collect(dir, out, match) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const absolute = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			collect(absolute, out, match);
			continue;
		}
		if (entry.isFile() && match(entry.name)) out.push(absolute);
	}
}

// 运行时会产出的名字：声明和 `export {}` 列表都算；`export type {}` 与 interface/type 在 JS 里没有导出。
const runtimeExports = (text, lists = true) => {
	const names = [
		...text.matchAll(/^export (?:async )?(?:function|const|class|let|var|enum|abstract class)\s+([A-Za-z_$][\w$]*)/gm),
	].map((match) => match[1]);
	if (lists)
		for (const list of text.matchAll(/^export\s*\{([^}]*)\}/gm))
			for (const item of (list[1] ?? "").split(",")) {
				const name = item
					.trim()
					.split(/\s+as\s+/)
					.pop()
					?.trim();
				if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.push(name);
			}
	return new Set(names);
};
const mtime = (path) => {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
};

/** Every dist module must exist, be newer than its source, and re-export the names its source exports. */
export function distDrift(packages = projectDirs()) {
	const problems = [];
	for (const path of packages) {
		const dir = resolve(ROOT, path);
		const dist = join(dir, "dist");
		const sources = [];
		collect(join(dir, "src"), sources, (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
		for (const source of sources) {
			const expected = join(dist, toPosix(relative(join(dir, "src"), source)).replace(/\.ts$/, ".js"));
			const built = mtime(expected);
			if (!built) {
				problems.push(`${toPosix(relative(ROOT, expected))}: dist 缺少这个模块`);
				continue;
			}
			if (built < mtime(source)) {
				problems.push(`${toPosix(relative(ROOT, expected))}: 比源码旧`);
				continue;
			}
			const text = readFileSync(source, "utf8");
			const builtExports = runtimeExports(readFileSync(expected, "utf8"));
			const missing = [...runtimeExports(text, false)].filter((name) => !builtExports.has(name));
			if (missing.length) problems.push(`${toPosix(relative(ROOT, expected))}: 缺少导出 ${missing.join(", ")}`);
		}
	}
	return problems;
}

/** 把一个 dist 产物路径映射回拥有它的 tsconfig 工程目录；认不出来时返回 undefined。 */
export function owningProject(problem, packages = projectDirs()) {
	return packages.find((path) => problem.startsWith(`${path}/dist/`));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const problems = distDrift();
	if (problems.length) {
		console.error(`dist 与源码不一致（${problems.length} 处）：`);
		for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
		if (problems.length > 20) console.error(`  …另有 ${problems.length - 20} 处`);
		console.error(`\n修：${REPAIR}（删掉 dist 后重新构建）。`);
		process.exit(1);
	}
	console.log("dist 与源码一致。");
}
