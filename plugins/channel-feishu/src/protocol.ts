// Protocol semantics adapted from OpenClaw cafa09e and Hermes 6660547 (MIT; NOTICE.md).
import { createHash } from "node:crypto";
import { type Attachment, type OutputPart, parseRef, type TSchema } from "@yonder/sdk";

export const deliveryUuid = (id: string | undefined, index: number) =>
	id ? createHash("sha256").update(`${id}:${index}`).digest("hex").slice(0, 32) : undefined;

export type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
	value !== null && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export function required(value: unknown, label: string): string {
	const result = string(value).trim();
	if (!result) throw new Error(`${label} is required`);
	return result;
}
export interface Config {
	appId: string;
	secret: string;
	domain?: "feishu" | "lark";
	renderMode?: "text" | "markdown" | "post" | "card";
	streaming?: boolean;
	replyInThread?: boolean;
	templateId?: string;
	templateVersion?: string;
	textChunkBytes?: number;
	mediaMaxBytes?: number;
	updateIntervalMs?: number;
	allowedUsers?: string[];
	allowedChats?: string[];
}
const str = { type: "string", minLength: 1 };
const list = { type: "array", items: str };
export const configSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		appId: str,
		secret: { ...str, description: "Credential name referencing an api_key; not the secret value" },
		domain: { enum: ["feishu", "lark"] },
		renderMode: { enum: ["text", "markdown", "post", "card"] },
		streaming: { type: "boolean" },
		replyInThread: { type: "boolean" },
		templateId: str,
		templateVersion: str,
		textChunkBytes: { type: "integer", minimum: 256, maximum: 20000 },
		mediaMaxBytes: { type: "integer", minimum: 1, maximum: 30000000 },
		updateIntervalMs: { type: "integer", minimum: 160, maximum: 5000 },
		allowedUsers: list,
		allowedChats: list,
	},
} as TSchema;
export interface Resource {
	key: string;
	kind: Attachment["kind"];
	name?: string;
}
export interface Parsed {
	text: string;
	resources: Resource[];
	mentions: string[];
}
export function parseContent(type: string, raw: string): Parsed {
	let body: ObjectValue;
	try {
		body = object(JSON.parse(raw));
	} catch {
		return { text: `[${type}: malformed content]`, resources: [], mentions: [] };
	}
	const resources: Resource[] = [];
	const mentions: string[] = [];
	const text: string[] = [];
	const seen = new Set<string>();
	const add = (key: unknown, kind: Resource["kind"], name?: unknown) => {
		if (typeof key !== "string" || !key || seen.has(key)) return;
		seen.add(key);
		resources.push({ key, kind, ...(string(name) ? { name: string(name) } : {}) });
	};
	function walk(value: unknown): void {
		if (Array.isArray(value)) {
			for (const entry of value) walk(entry);
			return;
		}
		const item = object(value);
		const tag = string(item.tag);
		if (["text", "md", "lark_md", "markdown", "plain_text", "code", "code_block"].includes(tag)) {
			const content = string(item.text) || string(item.content);
			if (content) text.push(content);
		} else if (tag === "a") text.push(`${string(item.text)} (${string(item.href)})`);
		else if (tag === "at") {
			const id = string(item.user_id) || string(item.open_id);
			if (id) mentions.push(id);
			text.push(`@${string(item.user_name) || id}`);
		} else if (tag === "br" || tag === "hr") text.push("\n");
		if (item.image_key) add(item.image_key, "image");
		if (item.file_key) add(item.file_key, tag === "media" ? "video" : "file", item.file_name);
		for (const [key, child] of Object.entries(item)) {
			if (typeof child === "object") walk(child);
			else if (["title", "text", "content"].includes(key) && typeof child === "string" && !tag) text.push(child);
		}
	}
	if (type === "text") text.push(string(body.text));
	else if (type === "post" || type === "interactive") {
		// A multilingual post is one message: select one actual locale, never duplicate each translation.
		const post = object(body.post ?? body);
		const locale = Array.isArray(post.content)
			? post
			: Object.values(post).find((v) => Array.isArray(object(v).content));
		walk(type === "post" ? (locale ?? post) : body);
		if (type === "post") {
			walk(body.files);
			if (post !== body) walk(post.files);
		}
	} else if (type === "image") add(body.image_key, "image");
	else if (["file", "audio", "media", "video"].includes(type)) {
		add(
			body.file_key,
			type === "media" || type === "video" ? "video" : type === "audio" ? "audio" : "file",
			body.file_name,
		);
		if (body.image_key) add(body.image_key, "image");
	} else walk(body);
	return { text: text.join("\n").trim() || `[Feishu ${type}]`, resources, mentions };
}

/** Split by the encoded content envelope, on code-point boundaries. */
export function chunks(text: string, maxBytes: number, encode: (text: string) => object): string[] {
	const result: string[] = [];
	const overhead = Buffer.byteLength(JSON.stringify(encode("")));
	let part = "",
		size = overhead;
	for (const char of text) {
		const increment = Buffer.byteLength(JSON.stringify(char)) - 2;
		if (size + increment > maxBytes) {
			if (!part) throw new Error("Configured text envelope is too small");
			result.push(part);
			part = "";
			size = overhead;
		}
		if (size + increment > maxBytes) throw new Error("Configured text envelope is too small");
		part += char;
		size += increment;
	}
	if (part) result.push(part);
	return result;
}

/** Abort waiting for the next output too; an idle producer must not strand an open card. */
export async function* cancellable(out: AsyncIterable<OutputPart>, signal: AbortSignal): AsyncGenerator<OutputPart> {
	const iterator = out[Symbol.asyncIterator]();
	try {
		for (;;) {
			signal.throwIfAborted();
			let onAbort = () => {};
			const aborted = new Promise<never>((_, reject) => {
				onAbort = () => reject(new DOMException("Feishu stream cancelled", "AbortError"));
				signal.addEventListener("abort", onAbort, { once: true });
			});
			let next: IteratorResult<OutputPart>;
			try {
				next = await Promise.race([iterator.next(), aborted]);
			} finally {
				signal.removeEventListener("abort", onAbort);
			}
			if (next.done) return;
			yield next.value;
		}
	} finally {
		void iterator.return?.().catch(() => {});
	}
}

export function textPayload(text: string, mode: Config["renderMode"]): { type: string; content: object } {
	if (mode === "text") return { type: "text", content: { text } };
	if (mode === "card")
		return {
			type: "interactive",
			content: { schema: "2.0", body: { elements: [{ tag: "markdown", content: text }] } },
		};
	return {
		type: "post",
		content: { zh_cn: { title: "", content: [[{ tag: mode === "post" ? "text" : "md", text }]] } },
	};
}
/** Native message edit: text/post use PUT, interactive cards use PATCH. */
export async function editMessage(
	client: { request(path: string, method: string, body?: object, signal?: AbortSignal): Promise<unknown> },
	mode: Config["renderMode"],
	id: string,
	msg: { text: string },
	signal?: AbortSignal,
): Promise<void> {
	const payload = textPayload(msg.text, mode);
	await client.request(
		`/im/v1/messages/${encodeURIComponent(id)}`,
		payload.type === "interactive" ? "PATCH" : "PUT",
		{ ...(payload.type !== "interactive" ? { msg_type: payload.type } : {}), content: JSON.stringify(payload.content) },
		signal,
	);
}
export function recipient(target: string, channel: string): { id: string; type: string } {
	const parsed = parseRef(target);
	if ((parsed.kind !== "acct" && parsed.kind !== "conv") || parsed.channel !== channel)
		throw new Error("Feishu target belongs to another instance");
	return { id: parsed.id, type: parsed.kind === "conv" ? "chat_id" : "open_id" };
}
export function mimeFromBytes(bytes: Buffer, fallback: string): string {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
	if (bytes.subarray(0, 4).toString() === "OggS") return "audio/ogg";
	if (bytes.subarray(4, 8).toString() === "ftyp") return "video/mp4";
	return fallback.split(";")[0]?.trim() || "application/octet-stream";
}
export function opusDuration(bytes: Buffer): number | undefined {
	if (bytes.subarray(0, 4).toString() !== "OggS" || !bytes.includes(Buffer.from("OpusHead"))) return;
	let last = 0n;
	for (let i = 0; i + 27 <= bytes.length; ) {
		const start = bytes.indexOf("OggS", i);
		if (start < 0 || start + 27 > bytes.length) break;
		const segments = bytes[start + 26] ?? 0;
		if (start + 27 + segments > bytes.length) break;
		const granule = bytes.readBigInt64LE(start + 6);
		if (granule > last) last = granule;
		let length = 0;
		for (let j = 0; j < segments; j++) length += bytes[start + 27 + j] ?? 0;
		i = start + 27 + segments + length;
	}
	return last > 0n ? Math.round((Number(last) * 1000) / 48000) : undefined;
}
