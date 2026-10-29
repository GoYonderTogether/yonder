import type { ToolContext, TSchema } from "@yonder/sdk";

const MAX_BODY = 2 * 1024 * 1024;
const MAX_OUTPUT = 65536;
const string = { type: "string", minLength: 1, pattern: "\\S" };
const urlString = { type: "string", minLength: 1 };
const choice = (...values: string[]) => ({ type: "string", enum: values });
const schema = (properties: object, required: string[]) =>
	({ type: "object", properties, required, additionalProperties: false }) as TSchema;
const urlValue = (value: unknown): URL => {
	if (typeof value !== "string") throw new Error("HTTP URL required");
	const url = new URL(value);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
		throw new Error("Public HTTP(S) URL without credentials required");
	return url;
};
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Arguments must be an object");
	return value as Record<string, unknown>;
}
function redact(message: string, ...secrets: Array<string | undefined>) {
	let text = message;
	for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]");
	return text;
}
async function output(value: object, ctx: ToolContext, key?: string) {
	let text = JSON.stringify(value, null, 2);
	if (key) text = text.split(key).join("[REDACTED]");
	if (Buffer.byteLength(text) > MAX_OUTPUT) {
		const path = await ctx.cacheToolOutput?.(text, { extension: "json" });
		text = `${Buffer.from(text).subarray(0, MAX_OUTPUT).toString("utf8")}\n[truncated: output limit 65536 bytes; ${path ? `cached at ${path}; use read to paginate or grep to search` : "cache unavailable"}]`;
	}
	return { text };
}
async function readBody(
	response: Response,
	cache?: ToolContext["cacheToolOutputStream"],
): Promise<{ text: string; truncated: boolean; path?: string }> {
	const reader = response.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (reader) {
			const chunk = await reader.read();
			if (chunk.done) break;
			const remaining = MAX_BODY - size;
			if (chunk.value.length > remaining) {
				const prefix = chunk.value.subarray(0, remaining);
				chunks.push(prefix);
				const path = await cache?.(
					(async function* () {
						yield* chunks;
						yield chunk.value.subarray(remaining);
						while (true) {
							const next = await reader.read();
							if (next.done) break;
							yield next.value;
						}
					})(),
					{ extension: "txt" },
				);
				return { text: Buffer.concat(chunks).toString("utf8"), truncated: true, ...(path ? { path } : {}) };
			}
			chunks.push(chunk.value);
			size += chunk.value.length;
		}
	} finally {
		await reader?.cancel();
	}
	return { text: Buffer.concat(chunks).toString("utf8"), truncated: false };
}

export { choice, MAX_BODY, MAX_OUTPUT, object, output, readBody, redact, schema, string, urlString, urlValue };
