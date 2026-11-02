import { createWriteStream, existsSync, mkdtempSync } from "node:fs";
import { open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import {
	createBackground as createSharedBackground,
	type RuntimeBackgroundOptions,
	type RuntimeOutputCapture,
} from "../../runtime/background.js";
import { cacheToolOutput } from "./tool-output-cache.js";

export * from "../../runtime/background.js";

export function createBackground(options: RuntimeBackgroundOptions) {
	const home = options.home;
	return createSharedBackground({
		...options,
		...(home
			? {
					outputCapture(input): RuntimeOutputCapture {
						const dir = mkdtempSync(join(tmpdir(), "yonder-output-"));
						const path = join(dir, "output");
						const stream = createWriteStream(path, { mode: 0o600 });
						return {
							write(text) {
								stream.write(text);
							},
							async finish() {
								if (!home) throw new Error("Local output cache requires a home directory");
								stream.end();
								await finished(stream);
								return cacheToolOutput(home, input.session, input.name, input.args, await readFile(path, "utf8"));
							},
							async cleanup() {
								stream.destroy();
								await rm(dir, { recursive: true, force: true });
							},
						};
					},
					logs: {
						joinPath: (...parts) => join(...parts),
						exists: async (path) => existsSync(path),
						async read(path, maxBytes, tail) {
							const totalBytes = (await stat(path)).size;
							const length = Math.min(totalBytes, maxBytes);
							if (!length) return { content: "", truncated: false, bytesRead: 0, totalBytes };
							const file = await open(path, "r");
							try {
								const buffer = new Uint8Array(length);
								const position = tail ? Math.max(0, totalBytes - length) : 0;
								const { bytesRead } = await file.read(buffer, 0, length, position);
								return {
									content: new TextDecoder().decode(buffer.subarray(0, bytesRead)),
									truncated: totalBytes > bytesRead,
									bytesRead,
									totalBytes,
								};
							} finally {
								await file.close();
							}
						},
					},
				}
			: {}),
	});
}
