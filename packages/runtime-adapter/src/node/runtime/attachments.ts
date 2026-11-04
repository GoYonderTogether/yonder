import { open, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Attachment } from "@yonder/sdk";
import { imageMime } from "../../runtime/input-content.js";

export { imageMime } from "../../runtime/input-content.js";

export async function readAttachment(uri: string): Promise<Uint8Array> {
	return readFile(uri.startsWith("file:") ? fileURLToPath(uri) : uri);
}
export async function attachmentFromPath(source: string): Promise<Attachment> {
	const path = resolve(source),
		file = await open(path, "r");
	try {
		const info = await file.stat();
		if (!info.isFile()) throw new Error(`Attachment is not a file: ${path}`);
		const header = Buffer.alloc(16);
		await file.read(header, 0, header.length, 0);
		const mime = imageMime(header);
		return {
			kind: mime ? "image" : "file",
			mime: mime ?? "application/octet-stream",
			uri: pathToFileURL(path).href,
			name: basename(path),
			bytes: info.size,
		};
	} finally {
		await file.close();
	}
}
