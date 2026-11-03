import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Attachment } from "@yonder/sdk";
export async function downloadAttachment(
	attachment: Attachment,
	home: string,
	signal: AbortSignal,
	event: string,
	index: number,
): Promise<Attachment> {
	if (!/^https?:\/\//u.test(attachment.uri)) return attachment;
	const directory = join(home, ".yonder/attachments");
	await mkdir(directory, { recursive: true });
	const path = join(directory, `${event}-${index}`);
	try {
		const saved = await stat(path);
		if (attachment.bytes !== undefined && saved.size !== attachment.bytes)
			throw new Error("Attachment cache size differs from received metadata");
		return { ...attachment, uri: pathToFileURL(path).href, bytes: saved.size };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const response = await fetch(attachment.uri, { signal });
	if (!response.ok) throw new Error(`Attachment download failed: HTTP ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (attachment.bytes !== undefined && bytes.length !== attachment.bytes)
		throw new Error("Attachment download size differs from received metadata");
	const temporary = join(directory, randomUUID());
	await writeFile(temporary, bytes);
	await rename(temporary, path);
	return { ...attachment, uri: pathToFileURL(path).href, bytes: bytes.length };
}
