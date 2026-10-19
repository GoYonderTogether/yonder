import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Attachment, ToolResult } from "@yonder/sdk";

/** Map protocol media at its defined content positions; structuredContent stays untouched. */
export async function mapMedia(result: unknown, directory: string) {
	const images: NonNullable<ToolResult["images"]> = [];
	const attachments: Attachment[] = [];
	async function block(input: unknown): Promise<unknown> {
		if (!input || typeof input !== "object" || Array.isArray(input)) return input;
		const value = input as Record<string, unknown>;
		if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
			const { data, ...metadata } = value;
			images.push({ mime: value.mimeType, data });
			return { ...metadata, bytes: Buffer.byteLength(data, "base64"), imageIndex: images.length - 1 };
		}
		const encoded = value.type === "audio" ? value.data : typeof value.uri === "string" ? value.blob : undefined;
		if (typeof encoded === "string") {
			const mime = typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream";
			const bytes = Buffer.from(encoded, "base64");
			const extension: Record<string, string> = {
				"image/png": "png",
				"image/jpeg": "jpg",
				"image/webp": "webp",
				"audio/wav": "wav",
				"audio/aiff": "aiff",
				"audio/mpeg": "mp3",
				"audio/ogg": "ogg",
				"audio/mp4": "m4a",
			};
			const name = `${randomUUID()}.${extension[mime] ?? "bin"}`;
			await mkdir(directory, { recursive: true });
			const path = join(directory, name);
			await writeFile(path, bytes, { mode: 0o600 });
			const attachment: Attachment = {
				kind: mime.startsWith("audio/") ? "audio" : mime.startsWith("image/") ? "image" : "file",
				mime,
				uri: pathToFileURL(path).href,
				name,
				bytes: bytes.length,
			};
			attachments.push(attachment);
			const { data: _data, blob: _blob, ...metadata } = value;
			return { ...metadata, artifact: attachment };
		}
		if (value.type === "resource") return { ...value, resource: await block(value.resource) };
		return value;
	}
	if (!result || typeof result !== "object" || Array.isArray(result)) return { result, images, attachments };
	const output = { ...(result as Record<string, unknown>) };
	if (Array.isArray(output.content)) output.content = await Promise.all(output.content.map(block));
	if (Array.isArray(output.contents)) output.contents = await Promise.all(output.contents.map(block));
	if (Array.isArray(output.messages))
		output.messages = await Promise.all(
			output.messages.map(async (message) => {
				if (!message || typeof message !== "object") return message;
				return { ...message, content: await block(message.content) };
			}),
		);
	return { result: output, images, attachments };
}
