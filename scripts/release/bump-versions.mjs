// 统一 workspace 包版本：除 packages/pi-durable 外所有包改为同一版本，内部 @yonder/* 依赖同步。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXCLUDED = new Set(["packages/pi-durable"]);

export function workspacePaths(rootManifest) {
	return (rootManifest.workspaces ?? []).filter((workspace) => !EXCLUDED.has(workspace));
}

/** 只替换版本号与内部 @yonder/* 依赖的值，保留原文件排版。 */
export function bumpManifestText(text, version) {
	return text
		.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
		.replace(/("@yonder\/[^"]+"\s*:\s*)"[^"]*"/g, `$1"${version}"`);
}

export function changedManifests(rootDir, version) {
	const root = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
	const paths = ["package.json", ...workspacePaths(root).map((workspace) => `${workspace}/package.json`)];
	const changes = [];
	for (const path of paths) {
		const before = readFileSync(join(rootDir, path), "utf8");
		const after = bumpManifestText(before, version);
		if (before !== after) changes.push({ path, contents: after });
	}
	return changes;
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	const dryRun = argv.includes("--dry-run");
	const version = flag("--version");
	if (!version) {
		console.error("用法：bump-versions.mjs --version <版本> [--dry-run]");
		return 2;
	}
	try {
		const changes = changedManifests(ROOT, version);
		for (const change of changes) {
			if (!dryRun) writeFileSync(join(ROOT, change.path), change.contents);
			console.log(`${dryRun ? "将修改" : "已修改"} ${change.path}`);
		}
		if (changes.length === 0) console.log(`所有包已是 ${version}`);
		if (dryRun) return 0;
		// lockfile 里 workspace 条目的版本由 npm 自己同步，不手改依赖版本
		execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], { cwd: ROOT, stdio: "inherit" });
		return 0;
	} catch (error) {
		console.error(error.message);
		return 1;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
