import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { manifest, sourceRoot } from "./paths.js";
import { selectChangelog } from "./versions.js";

export async function readDocs(path?: string, list = false): Promise<string | string[]> {
	const root = await realpath(join(sourceRoot, "docs"));
	if (list) {
		const files: string[] = [];
		const walk = async (directory: string) => {
			for (const entry of await readdir(directory, { withFileTypes: true })) {
				const child = join(directory, entry.name);
				if (entry.isDirectory()) await walk(child);
				else if (entry.isFile()) files.push(relative(root, child));
			}
		};
		const directory = path ? await realpath(resolve(root, path)) : root;
		const inside = relative(root, directory);
		if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\"))
			throw new Error("Document path must stay inside docs/");
		await walk(directory);
		return files.sort();
	}
	const target = await realpath(resolve(root, path ?? "index.md")),
		inside = relative(root, target);
	if (isAbsolute(inside) || inside === ".." || inside.startsWith("../") || inside.startsWith("..\\"))
		throw new Error("Document path must stay inside docs/");
	return readFile(target, "utf8");
}
export async function readChangelog(from?: string, to?: string): Promise<string> {
	return selectChangelog(
		await readFile(join(sourceRoot, "CHANGELOG.md"), "utf8"),
		from,
		to ?? (await manifest(join(sourceRoot, "packages/cli"))).version,
	);
}
