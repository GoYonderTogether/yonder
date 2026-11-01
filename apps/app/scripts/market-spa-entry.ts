import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

/** The static host serves /market/ as a directory because public market photos share its name. */
export function marketSpaEntry(): Plugin {
	let directory = "";
	let rootWeb = false;
	return {
		name: "market-spa-entry",
		apply: "build",
		enforce: "post",
		configResolved(config) {
			rootWeb = config.base === "/";
			directory = resolve(config.root, config.build.outDir);
		},
		writeBundle: {
			order: "post",
			handler() {
				if (!rootWeb) return;
				mkdirSync(join(directory, "market"), { recursive: true });
				copyFileSync(join(directory, "index.html"), join(directory, "market", "index.html"));
			},
		},
	};
}
