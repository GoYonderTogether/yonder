import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { command } from "./exec.js";
import { installPath, manifest, sourceRoot } from "./paths.js";
import { compareVersions, normalizeVersion } from "./versions.js";

export async function releaseInfo(home?: string) {
	const originFile = join(sourceRoot, ".yonder-install.json");
	return {
		version: (await manifest(join(sourceRoot, "packages/cli"))).version,
		install: installPath(),
		source: sourceRoot,
		home: home ?? null,
		origin: existsSync(originFile) ? JSON.parse(await readFile(originFile, "utf8")) : null,
	};
}
export async function checkRelease() {
	const root = await manifest();
	const repository = typeof root.repository === "string" ? root.repository : root.repository?.url;
	if (!repository) throw new Error("Repository is not configured");
	const url = new URL(repository);
	const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
	if (url.hostname !== "github.com" || !match)
		throw new Error("Update checks require the configured GitHub repository");
	const release = JSON.parse(
		(await command("gh", ["api", `repos/${match[1]}/${match[2]}/releases/latest`])).stdout,
	) as { tag_name: string; html_url: string; draft: boolean; prerelease: boolean };
	if (release.draft || release.prerelease) throw new Error("Latest release is not a formal release");
	const latest = normalizeVersion(release.tag_name),
		current = (await manifest(join(sourceRoot, "packages/cli"))).version;
	return { current, latest, updateAvailable: compareVersions(latest, current) > 0, url: release.html_url };
}
