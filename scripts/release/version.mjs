// 发版版本号计算与校验：0.<minor>.<YYMMDDNN>，NN 为当天序号（docs/spec/09 §5）。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VERSION_PATTERN = /^0\.(\d+)\.(\d{6})(\d{2})$/;
const TAG_PATTERN = /^v(0\.\d+\.\d{8})$/;

export function parseVersion(version) {
	const match = VERSION_PATTERN.exec(version);
	if (!match) return null;
	return { minor: Number(match[1]), date: match[2], sequence: Number(match[3]) };
}

export function formatVersion({ minor, date, sequence }) {
	return `0.${minor}.${date}${String(sequence).padStart(2, "0")}`;
}

/** 发布日 YYMMDD，默认按 UTC 计算，保证 CI 与本机结果一致。 */
export function dateStamp(now = new Date()) {
	const year = String(now.getUTCFullYear() % 100).padStart(2, "0");
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	const day = String(now.getUTCDate()).padStart(2, "0");
	return `${year}${month}${day}`;
}

export function tagVersions(tags) {
	return tags.map((tag) => TAG_PATTERN.exec(tag)?.[1]).filter(Boolean);
}

export function compareVersions(left, right) {
	const [leftParsed, rightParsed] = [parseVersion(left), parseVersion(right)];
	if (!leftParsed || !rightParsed) throw new Error(`无法比较版本：${left} / ${right}`);
	if (leftParsed.minor !== rightParsed.minor) return Math.sign(leftParsed.minor - rightParsed.minor);
	return Math.sign(
		Number(`${leftParsed.date}${leftParsed.sequence}`) - Number(`${rightParsed.date}${rightParsed.sequence}`),
	);
}

/** 当天该 minor 的下一个序号：已有 tag 的最大 NN 加一，没有则为 01。 */
export function nextVersion({ minor, date, tags }) {
	let sequence = 0;
	for (const version of tagVersions(tags)) {
		const parsed = parseVersion(version);
		if (parsed && parsed.minor === minor && parsed.date === date) sequence = Math.max(sequence, parsed.sequence);
	}
	const next = sequence + 1;
	if (next > 99) throw new Error(`${date} 的序号已用尽（${sequence}），无法再发版`);
	return formatVersion({ minor, date, sequence: next });
}

/** 显式指定的版本：格式合法且高于已有最高 tag。 */
export function assertReleaseVersion(version, tags) {
	const parsed = parseVersion(version);
	if (!parsed) throw new Error(`版本号格式不是 0.<minor>.<YYMMDDNN>：${version}`);
	const known = tagVersions(tags).sort(compareVersions);
	const highest = known.at(-1);
	if (highest && compareVersions(version, highest) <= 0) {
		throw new Error(`版本 ${version} 不高于已有 tag v${highest}`);
	}
	return version;
}

export function releasedTags(tags) {
	return tags.filter((tag) => TAG_PATTERN.test(tag));
}

/** `git log --no-walk --tags --format='%H %P%x09%D%x09%s'` 的一行 → 带 tag 的提交记录。 */
export function parseTaggedCommit(line) {
	const [shas = "", refs = "", subject = ""] = line.split("\t");
	const [sha, ...parents] = shas.trim().split(" ");
	const tags = [...refs.matchAll(/tag: ([^,\s]+)/g)].map((match) => match[1]);
	return { sha, parents, tags: releasedTags(tags), subject };
}

/** 已经发过的 tag：tag 就在 head 上，或 head 是某个 CI 发版提交的父提交。 */
export function releaseOf(head, commits) {
	for (const commit of commits) {
		if (commit.tags.length === 0) continue;
		if (commit.sha === head) return commit.tags[0];
		if (commit.subject.startsWith("chore(release):") && commit.parents.includes(head)) return commit.tags[0];
	}
	return null;
}

function git(...args) {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function readMinor() {
	return parseVersion(JSON.parse(readFileSync(`${ROOT}package.json`, "utf8")).version)?.minor ?? 0;
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	const tags = git("tag", "--list", "v*").split("\n").filter(Boolean);
	try {
		if (argv.includes("--assert-unreleased")) {
			const head = git("rev-parse", "HEAD").trim();
			const commits = git("log", "--no-walk", "--tags=v0.*", "--format=%H %P%x09%D%x09%s")
				.split("\n")
				.filter(Boolean)
				.map(parseTaggedCommit);
			const released = releaseOf(head, commits);
			if (released) throw new Error(`${head} 已经发过 ${released}，同一 commit 不重复发版`);
			console.log("HEAD 尚未发版");
			return 0;
		}
		if (argv.includes("--validate")) {
			console.log(assertReleaseVersion(flag("--validate") ?? "", tags));
			return 0;
		}
		if (argv.includes("--next")) {
			const explicit = flag("--version");
			const version = explicit
				? assertReleaseVersion(explicit, tags)
				: nextVersion({ minor: readMinor(), date: flag("--date") || dateStamp(), tags });
			console.log(version);
			return 0;
		}
		console.error(
			"用法：version.mjs --next [--version <版本>] [--date YYMMDD] | --validate <版本> | --assert-unreleased",
		);
		return 2;
	} catch (error) {
		console.error(error.message);
		return 1;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
