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
async function readBytes(
	response: Response,
	cache?: ToolContext["cacheToolOutputStream"],
	extension = "txt",
): Promise<{ bytes: Uint8Array; truncated: boolean; path?: string }> {
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
					{ extension },
				);
				return { bytes: Buffer.concat(chunks), truncated: true, ...(path ? { path } : {}) };
			}
			chunks.push(chunk.value);
			size += chunk.value.length;
		}
	} finally {
		await reader?.cancel();
	}
	return { bytes: Buffer.concat(chunks), truncated: false };
}
async function readBody(
	response: Response,
	cache?: ToolContext["cacheToolOutputStream"],
): Promise<{ text: string; truncated: boolean; path?: string }> {
	const body = await readBytes(response, cache);
	return {
		text: Buffer.from(body.bytes).toString("utf8"),
		truncated: body.truncated,
		...(body.path ? { path: body.path } : {}),
	};
}
const REDIRECTS = [301, 302, 303, 307, 308];
/** Text-ish bodies are read; anything else is reported as binary without downloading it. */
function readable(mime: string): boolean {
	return (
		mime.startsWith("text/") ||
		mime.endsWith("+json") ||
		[
			"application/xhtml+xml",
			"application/json",
			"application/xml",
			"application/pdf",
			"application/x-pdf",
			"application/octet-stream",
		].includes(mime)
	);
}
export type HttpResult =
	| { kind: "body"; url: URL; mime: string; bytes: Uint8Array; truncated: boolean; path?: string }
	| { kind: "binary"; url: URL; mime: string };
async function httpGet(
	input: URL,
	ctx: ToolContext,
	options: { accept?: string; extension?: string } = {},
): Promise<HttpResult> {
	let url = input;
	const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]);
	for (let redirects = 0; redirects <= 5; redirects++) {
		signal.throwIfAborted();
		const response = await fetch(url, {
			method: "GET",
			credentials: "omit",
			redirect: "manual",
			signal,
			...(options.accept ? { headers: { accept: options.accept } } : {}),
		});
		if (REDIRECTS.includes(response.status)) {
			await response.body?.cancel();
			const next = response.headers.get("location");
			if (!next) throw new Error("Redirect missing Location");
			url = urlValue(new URL(next, url).href);
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`HTTP ${response.status} ${url.href}${[401, 403].includes(response.status) ? "; use BrowserSkill with an authorized login" : ""}`,
			);
		}
		const mime =
			response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
		if (!readable(mime)) {
			await response.body?.cancel();
			return { kind: "binary", url, mime };
		}
		const body = await readBytes(response, ctx.cacheToolOutputStream, options.extension ?? "txt");
		return {
			kind: "body",
			url,
			mime,
			bytes: body.bytes,
			truncated: body.truncated,
			...(body.path ? { path: body.path } : {}),
		};
	}
	throw new Error("Too many redirects (maximum 5)");
}

export { choice, httpGet, MAX_BODY, MAX_OUTPUT, object, output, readBody, redact, schema, string, urlString, urlValue };
