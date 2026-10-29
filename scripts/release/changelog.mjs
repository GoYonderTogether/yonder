// CHANGELOG 小节生成：把上一个 tag 到当前 ref 的提交按 conventional commit 类型分组写进新版本小节。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CHANGELOG = `${ROOT}CHANGELOG.md`;
const UNRELEASED = /^## \[Unreleased\]\s*$/;
const HEADING = /^## /;
// 只有这些 conventional 类型进 CHANGELOG；docs/chore/ci/test/style/prompts 与无前缀提交不列
const TYPE_GROUPS = {
	feat: "Added",
	fix: "Fixed",
	perf: "Changed",
	refactor: "Changed",
	revert: "Removed",
};
// 发版提交自身不进 CHANGELOG
const SKIP = [/^chore\(release\):/, /^Merge /, /^Revert "chore\(release\)/];

function blockEnd(lines, start) {
	const end = lines.findIndex((line, index) => index > start && HEADING.test(line));
	return end === -1 ? lines.length : end;
}

/** 提交标题 → 分组条目，文本为「scope：描述」。 */
export function groupCommits(subjects) {
	const groups = {};
	for (const subject of subjects) {
		const title = subject.trim();
		if (!title || SKIP.some((pattern) => pattern.test(title))) continue;
		const match = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(title);
		const group = match && TYPE_GROUPS[match[1]];
		if (!group) continue;
		const text = [match[2], match[3]].filter(Boolean).join("：");
		groups[group] ??= [];
		if (!groups[group].includes(text)) groups[group].push(text);
	}
	return groups;
}

/** `## [Unreleased]` 已经手写的内容：无小节的条目进 lead，`### 小节` 里进 groups。 */
export function parseUnreleased(changelog) {
	const lines = changelog.split("\n");
	const lead = [];
	const groups = {};
	const start = lines.findIndex((line) => UNRELEASED.test(line));
	if (start === -1) return { lead, groups };
	let current = null;
	for (const raw of lines.slice(start + 1, blockEnd(lines, start))) {
		const line = raw.trim();
		if (!line) continue;
		const heading = /^###\s+(.+)$/.exec(line);
		if (heading) {
			current = heading[1];
			groups[current] ??= [];
			continue;
		}
		const entry = line.replace(/^-\s+/, "");
		if (current) {
			groups[current].push(entry);
		} else {
			lead.push(entry);
		}
	}
	return { lead, groups };
}

/** 手写内容在前，本次提交按类型并入同名小节。 */
export function mergeDerived(parsed, derived) {
	const lead = [...parsed.lead];
	const groups = Object.fromEntries(Object.entries(parsed.groups).map(([name, entries]) => [name, [...entries]]));
	for (const [name, entries] of Object.entries(derived)) {
		groups[name] ??= [];
		for (const entry of entries) if (!groups[name].includes(entry)) groups[name].push(entry);
	}
	return { lead, groups };
}

export function renderSection({ version, date, lead = [], groups = {} }) {
	const parts = [`## [${version}] - ${date}`];
	if (lead.length > 0) parts.push(lead.map((entry) => `- ${entry}`).join("\n"));
	for (const [name, entries] of Object.entries(groups)) {
		if (entries.length > 0) parts.push(`### ${name}\n\n${entries.map((entry) => `- ${entry}`).join("\n")}`);
	}
	return parts.join("\n\n");
}

export function applySection(changelog, section) {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => UNRELEASED.test(line));
	if (start === -1) throw new Error("CHANGELOG.md 缺少 ## [Unreleased] 小节");
	const end = blockEnd(lines, start);
	const next = [...lines.slice(0, start + 1), "", ...section.trimEnd().split("\n"), "", ...lines.slice(end)];
	return next.join("\n");
}

export function extractSection(changelog, version) {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
	if (start === -1) return null;
	return lines
		.slice(start + 1, blockEnd(lines, start))
		.join("\n")
		.trim();
}

function git(...args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function subjectsSince(ref) {
	let previous = "";
	try {
		previous = git("describe", "--tags", "--abbrev=0", "--match", "v0.*", ref).trim();
	} catch {
		previous = "";
	}
	const range = previous ? `${previous}..${ref}` : ref;
	return git("log", "--no-merges", "--format=%s", range).split("\n");
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	const dryRun = argv.includes("--dry-run");
	try {
		if (argv.includes("--body")) {
			const body = extractSection(readFileSync(CHANGELOG, "utf8"), flag("--body") ?? "");
			if (body === null) throw new Error(`CHANGELOG.md 里没有 ${flag("--body")} 的小节`);
			console.log(body);
			return 0;
		}
		if (argv.includes("--build")) {
			const version = flag("--version");
			if (!version) throw new Error("--build 需要 --version");
			const ref = flag("--ref") || "HEAD";
			const changelog = readFileSync(CHANGELOG, "utf8");
			const merged = mergeDerived(parseUnreleased(changelog), groupCommits(subjectsSince(ref)));
			const section = renderSection({ version, date: new Date().toISOString().slice(0, 10), ...merged });
			const next = applySection(changelog, section);
			if (dryRun) {
				console.log(section);
				return 0;
			}
			writeFileSync(CHANGELOG, next);
			console.log(`CHANGELOG.md 已写入 ${version}`);
			return 0;
		}
		console.error("用法：changelog.mjs --build --version <版本> [--ref <ref>] [--dry-run] | --body <版本>");
		return 2;
	} catch (error) {
		console.error(error.message);
		return 1;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
