import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Attachment } from "@yonder/sdk";

export function imageMime(bytes: Uint8Array): string | undefined {
	const header = Buffer.from(bytes.subarray(0, 16));
	if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
	if (/^GIF8[79]a/.test(header.toString("ascii"))) return "image/gif";
	if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
	return undefined;
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
