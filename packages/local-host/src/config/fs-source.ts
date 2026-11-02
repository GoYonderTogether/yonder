import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SourceDirectory } from "@yonder/bot-definition/source";

/** Local definition assets; workspace execution environments are selected separately. */
export function localSourceDirectory(root: string): SourceDirectory {
	return {
		root,
		files: {
			readFile: (path) => readFile(resolve(root, path), "utf8"),
			writeFile: (path, content) => writeFile(resolve(root, path), content),
			exists: async (path) => {
				try {
					await stat(resolve(root, path));
					return true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
					throw error;
				}
			},
			list: async (path) =>
				(await readdir(resolve(root, path), { withFileTypes: true })).map((entry) => ({
					name: entry.name,
					type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "symlink",
				})),
		},
	};
}
