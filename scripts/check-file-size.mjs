import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

// 文件行数预算：超 500 行的源文件必须登记在基线里，且只能变短不能变长。
const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "scripts/file-size-baseline.json");
const SCAN_DIRS = ["packages", "plugins"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".build", ".yonder"]);
// 第三方 vendored 源码不受本仓库规范约束
const SKIP_PREFIXES = ["packages/pi-durable/"];
const LIMIT = 500;

const wantJson = process.argv.includes("--json");

function toPosix(path) {
	return path.split(sep).join("/");
}

// 递归收集待检查的 .ts 文件，返回相对仓库根目录的 posix 路径
function collectSourceFiles(dir, out) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const absolute = join(dir, entry.name);
		const rel = toPosix(relative(ROOT, absolute));
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			if (SKIP_PREFIXES.some((prefix) => `${rel}/`.startsWith(prefix))) continue;
			collectSourceFiles(absolute, out);
			continue;
		}
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith(".ts")) continue;
		// 测试文件不计入预算
		if (entry.name.endsWith(".test.ts")) continue;
		out.push(rel);
	}
}

// 按 \n 计数，与 wc -l 语义一致（末尾无换行的最后一行不计）
function countLines(absolute) {
	const text = readFileSync(absolute, "utf8");
	let lines = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

function fail(message) {
	if (wantJson) {
		console.log(JSON.stringify({ ok: false, error: message }, null, 2));
	} else {
		console.error(message);
	}
	process.exit(1);
}

function loadBaseline() {
	let raw;
	try {
		raw = readFileSync(BASELINE_PATH, "utf8");
	} catch {
		fail(`缺少基线文件：scripts/file-size-baseline.json`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		fail(`基线文件不是合法 JSON：${error.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		fail('基线文件顶层必须是对象：{ "<文件路径>": { "lines": 数字, "reason": 字符串 } }');
	}
	const baseline = new Map();
	for (const [file, entry] of Object.entries(parsed)) {
		if (entry === null || typeof entry !== "object" || typeof entry.lines !== "number") {
			fail(`基线条目格式错误：${file}，需要 { "lines": 数字, "reason": 字符串 }`);
		}
		baseline.set(toPosix(file), { lines: entry.lines, reason: entry.reason ?? "" });
	}
	return baseline;
}

function main() {
	const baseline = loadBaseline();

	const files = [];
	for (const dir of SCAN_DIRS) collectSourceFiles(resolve(ROOT, dir), files);

	const added = []; // 新增超限文件：不在基线里
	const grown = []; // 基线只减不增：比基线记录更长
	const stale = []; // 基线腐烂：文件已消失或已降到阈值以内
	const within = []; // 基线内且未增长

	for (const file of files) {
		const lines = countLines(resolve(ROOT, file));
		const entry = baseline.get(file);
		if (!entry) {
			if (lines > LIMIT) added.push({ file, lines });
			continue;
		}
		baseline.delete(file);
		if (lines > entry.lines) {
			grown.push({ file, lines, baseline: entry.lines });
		} else if (lines <= LIMIT) {
			stale.push({ file, lines, reason: entry.reason, kind: "shrunk" });
		} else {
			within.push({ file, lines, baseline: entry.lines });
		}
	}

	// 基线里剩下的条目，对应文件已经不存在
	for (const [file, entry] of baseline) {
		stale.push({ file, lines: null, reason: entry.reason, kind: "missing" });
	}

	added.sort((a, b) => b.lines - a.lines);
	grown.sort((a, b) => b.lines - b.baseline - (a.lines - a.baseline));
	stale.sort((a, b) => a.file.localeCompare(b.file));

	const ok = added.length === 0 && grown.length === 0 && stale.length === 0;

	if (wantJson) {
		console.log(
			JSON.stringify(
				{
					ok,
					limit: LIMIT,
					scanned: files.length,
					baselineEntries: grown.length + within.length + stale.length,
					added,
					grown,
					stale,
					within,
				},
				null,
				2,
			),
		);
		process.exit(ok ? 0 : 1);
	}

	const out = [];
	out.push(`文件行数检查（阈值 ${LIMIT} 行，基线只减不增）`);
	out.push(`扫描 ${files.length} 个 .ts 文件，基线登记 ${within.length + grown.length + stale.length} 条`);

	if (added.length > 0) {
		out.push("");
		out.push("✗ 新增超限文件（未登记在基线）：");
		for (const item of added) {
			out.push(`  ${item.file}  ${item.lines} 行，超 ${item.lines - LIMIT} 行`);
		}
		out.push("  → 拆分到 500 行以内；确需保留则登记到 scripts/file-size-baseline.json 并写明待拆理由");
	}

	if (grown.length > 0) {
		out.push("");
		out.push("✗ 基线只减不增（行数比基线记录更多）：");
		for (const item of grown) {
			out.push(`  ${item.file}  ${item.lines} 行，基线 ${item.baseline} 行，多 ${item.lines - item.baseline} 行`);
		}
		out.push("  → 把新增内容拆到新模块，让行数回落到基线以内");
	}

	if (stale.length > 0) {
		out.push("");
		out.push("✗ 基线腐烂（请从 scripts/file-size-baseline.json 删除这些条目）：");
		for (const item of stale) {
			if (item.kind === "missing") {
				out.push(`  ${item.file}  文件已不存在`);
			} else {
				out.push(`  ${item.file}  现在 ${item.lines} 行，已不超限`);
			}
		}
	}

	if (ok) {
		out.push("");
		out.push(`✓ 通过：${within.length} 个文件在基线内且未增长`);
	}

	console.log(out.join("\n"));
	process.exit(ok ? 0 : 1);
}

main();
