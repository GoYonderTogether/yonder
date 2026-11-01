// 把测试里写死的临时目录换成跨平台的 `tempHome`（@yonder/sdk/testing）。
//
// 三种平台各坏一种：Windows 没有 /tmp；macOS 的 os.tmpdir() 很长，home 下再拼
// `.yonder/plugins/channel-cli/cli.sock` 会超过 AF_UNIX 的 104 字节上限（listen EINVAL）；
// Linux 两者都还行。`tempHome` 统一挑一个短且可写的根目录。
//
// 只做机械替换，跳过明显是测试数据/断言文本的字面量：
//   mkdtemp("/tmp/x-")                → tempHome("x-")
//   mkdtemp(join(tmpdir(), "x-"))     → tempHome("x-")
//   mkdtempSync("/tmp/x-")            → tempHomeSync("x-")
// 同时补齐 import，并去掉因此不再使用的 tmpdir。
//
// 用法：node scripts/migrate/windows-temp-paths.mjs [--write]
// 不带 --write 时只打印将要修改的文件与处数。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const EXT = /\.(ts|mjs|js)$/;

// 这些引号里的内容会出现在被测数据或断言文本中，替换会改变语义。
const KEEP_LINES = [/"path":"\/tmp\//, /ExecStart="/, /toContain\("\/tmp/, /"(file|http|data|blob):/];

// 整个文件的字面量都是纯数据（URL/路径字符串比较、断言文本），不参与文件系统操作。
const KEEP_FILES = new Set([
	"packages/core/src/config/config.test.ts",
	"packages/core/src/release/release.test.ts",
	"packages/core/src/release/verify.test.ts",
	"packages/core/src/release/platform-service.test.ts",
	"packages/core/src/runtime/tool-images.test.ts",
	"packages/core/src/runtime/image-history.test.ts",
]);

const CALLS = [
	[/\bmkdtemp\(\s*["']\/tmp\/([^"']*)["']\s*\)/g, 'tempHome("$1")'],
	[/\bmkdtempSync\(\s*["']\/tmp\/([^"']*)["']\s*\)/g, 'tempHomeSync("$1")'],
	[/\bmkdtemp\(\s*join\(\s*tmpdir\(\)\s*,\s*["']([^"']*)["']\s*\)\s*\)/g, 'tempHome("$1")'],
	[/\bmkdtempSync\(\s*join\(\s*tmpdir\(\)\s*,\s*["']([^"']*)["']\s*\)\s*\)/g, 'tempHomeSync("$1")'],
	[/\bmkdtemp\(\s*join\(\s*["']\/tmp["']\s*,\s*["']([^"']*)["']\s*\)\s*\)/g, 'tempHome("$1")'],
];

function rewrite(source) {
	let changed = false;
	let next = source;
	for (const [pattern, replacement] of CALLS) {
		next = next.replace(pattern, (_match, prefix) => {
			changed = true;
			return replacement.replace("$1", prefix ?? "");
		});
	}
	return { changed, source: next };
}

function ensureImport(source) {
	const names = ["tempHome", ...(/\btempHomeSync\(/.test(source) ? ["tempHomeSync"] : [])];
	const existing = /import\s*\{([^}]*)\}\s*from\s*["']@yonder\/sdk\/testing["']/;
	if (existing.test(source)) {
		return source.replace(existing, (_match, inner) => {
			const list = inner
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			for (const name of names) if (!list.includes(name)) list.push(name);
			return `import { ${list.join(", ")} } from "@yonder/sdk/testing"`;
		});
	}
	// 插在第一个 import 之前：此时它必然是多行 import 语句的边界，不会落进 `import {` 与
	// 其成员之间（那就是非法的 TypeScript）。
	const lines = source.split("\n");
	const first = lines.findIndex((line) => /^import\s/.test(line));
	lines.splice(first === -1 ? 0 : first, 0, `import { ${names.join(", ")} } from "@yonder/sdk/testing";`);
	return lines.join("\n");
}

/** 用不到 tmpdir 时，把它从 node:os 的 import 里去掉；整个 import 空了就删掉这一行。 */
function pruneTmpdir(source) {
	if (/\btmpdir\(/.test(source)) return source;
	return source
		.replace(/import\s*\{([^}]*)\}\s*from\s*["']node:os["'];\n/, (_match, inner) => {
			const rest = inner
				.split(",")
				.map((part) => part.trim())
				.filter((part) => part && part !== "tmpdir");
			return rest.length ? `import { ${rest.join(", ")} } from "node:os";\n` : "";
		})
		.replace(/\n\n\n+/g, "\n\n");
}

function tracked() {
	const list = (args) =>
		execFileSync("git", ["grep", "-l", "--", ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	const paths = ["packages", "plugins", "tests", "apps/app/src", "apps/app/scripts"];
	const found = [...list(["/tmp/", ...paths]).split("\n"), ...list(["join(tmpdir()", ...paths]).split("\n")];
	return [...new Set(found)]
		.filter(Boolean)
		.filter((path) => EXT.test(path) && /\.test\.(ts|mjs)$|\/test\/|fixture/.test(path))
		.filter((path) => !path.startsWith("apps/desktop/"));
}

function main(args) {
	const write = args.includes("--write");
	const touched = [];
	for (const path of tracked()) {
		if (KEEP_FILES.has(path)) continue;
		const before = readFileSync(path, "utf8");
		// 文件自己定义了同名 helper 时跳过，避免 import 与本地声明冲突。
		if (/\b(function|const|async function)\s+tempHome\b/.test(before)) continue;
		const { changed, source } = rewrite(before);
		if (!changed) continue;
		const beforeLines = new Set(before.split("\n"));
		const introduced = source.split("\n").filter((line) => !beforeLines.has(line));
		if (introduced.some((line) => KEEP_LINES.some((pattern) => pattern.test(line)))) continue;
		const after = pruneTmpdir(ensureImport(source));
		touched.push(path);
		if (write) writeFileSync(path, after);
	}
	console.log(`${write ? "已" : "将"}修改 ${touched.length} 个文件`);
	for (const path of touched) console.log(`  ${path}`);
	return 0;
}

if (process.argv[1]) process.exitCode = main(process.argv.slice(2));
