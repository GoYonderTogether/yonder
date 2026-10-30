export const versionPattern =
	/^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

/** Semver ordering: a pre-release (for example `-beta.1`) sorts before the same X.Y.Z without one. */
export function compareVersions(a: string, b: string): number {
	const left = versionPattern.exec(a),
		right = versionPattern.exec(b);
	if (!left || !right) throw new Error("Version must be X.Y.Z[-prerelease] or vX.Y.Z[-prerelease]");
	for (let index = 1; index <= 3; index++) {
		const delta = BigInt(left[index] ?? "0") - BigInt(right[index] ?? "0");
		if (delta) return delta < 0n ? -1 : 1;
	}
	const l = left[4]?.split("."),
		r = right[4]?.split(".");
	if (!l || !r) return l ? -1 : r ? 1 : 0;
	for (let index = 0; index < Math.max(l.length, r.length); index++) {
		const x = l[index],
			y = r[index];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const numeric = /^\d+$/u;
		if (numeric.test(x) && numeric.test(y)) {
			const delta = BigInt(x) - BigInt(y);
			if (delta) return delta < 0n ? -1 : 1;
		} else if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
		else if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}
export function normalizeVersion(version: string): string {
	if (!versionPattern.test(version)) throw new Error(`Invalid release version: ${version}`);
	return version.replace(/^v/u, "");
}
/** Highest release tag. Stable by default; pass `prerelease` to include test builds such as `v0.2.26102002`. */
export function latestRelease(tags: string[], prerelease = false): string {
	const versions = tags.filter(
		(tag) => tag.startsWith("v") && versionPattern.test(tag) && (prerelease || !tag.includes("-")),
	);
	versions.sort(compareVersions);
	const tag = versions.at(-1);
	if (!tag) throw new Error("The repository has no vX.Y.Z release tags");
	return tag;
}
export function selectChangelog(text: string, from: string | undefined, to: string): string {
	const upper = normalizeVersion(to),
		lower = from === undefined ? undefined : normalizeVersion(from);
	const headings = [...text.matchAll(/^## \[([^\]]+)\][^\n]*$/gmu)];
	const releases = headings.flatMap((match, index) => {
		const version = match[1];
		if (!version || !versionPattern.test(version)) return [];
		return [
			{
				version: normalizeVersion(version),
				text: text.slice(match.index, headings[index + 1]?.index ?? text.length).trimEnd(),
			},
		];
	});
	const previous =
		lower ??
		releases
			.map((item) => item.version)
			.filter((version) => compareVersions(version, upper) < 0)
			.sort(compareVersions)
			.at(-1);
	return releases
		.filter(
			(item) =>
				compareVersions(item.version, upper) <= 0 &&
				(previous === undefined || compareVersions(item.version, previous) > 0),
		)
		.map((item) => item.text)
		.join("\n\n");
}
