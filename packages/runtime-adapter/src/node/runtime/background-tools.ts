import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	type BackgroundLogReader,
	createBackgroundTools as createSharedBackgroundTools,
} from "../../runtime/background-tools.js";

export * from "../../runtime/background-tools.js";

export function createBackgroundTools(
	options: Parameters<typeof createSharedBackgroundTools>[0],
): ReturnType<typeof createSharedBackgroundTools> {
	return createSharedBackgroundTools({
		...options,
		logs:
			options.logs ??
			({
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
			} satisfies BackgroundLogReader),
	});
}
