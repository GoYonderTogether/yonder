import { randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Api, Credential, CredentialStore, Model } from "@earendil-works/pi-ai";

const sensitiveHeaders = new Set(["authorization", "x-api-key", "api-key", "cookie", "x-goog-api-key"]);
let state: { directory: string; bases: Set<string>; secrets: Set<string> } | undefined;

export function enableProviderTrace(): boolean {
	const directory = process.env.YONDER_PROVIDER_TRACE;
	if (!directory) return false;
	if (state) return true;
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	for (const name of readdirSync(directory)) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(directory, name);
		if (Date.now() - statSync(path).mtimeMs > 24 * 60 * 60 * 1000) unlinkSync(path);
	}
	state = { directory, bases: new Set(), secrets: new Set() };
	console.error("⚠️ YONDER_PROVIDER_TRACE 已开启：请求和响应会写入本地 trace，仅限验收 HOME！");
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
		if (
			![...state!.bases].some((base) => {
				const candidate = new URL(base);
				return (
					url.origin === candidate.origin &&
					(url.pathname === candidate.pathname.replace(/\/$/, "") ||
						url.pathname.startsWith(`${candidate.pathname.replace(/\/$/, "")}/`))
				);
			})
		)
			return original(input, init);
		const request = new Request(input, init);
		const file = join(state!.directory, `${Date.now()}-${randomUUID()}.jsonl`);
		const redact = (value: string) => {
			for (const secret of state!.secrets) {
				value = value.replaceAll(secret, "[REDACTED]");
				value = value.replaceAll(JSON.stringify(secret).slice(1, -1), "[REDACTED]");
			}
			return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/Bearer \S+/gi, "Bearer [REDACTED]");
		};
		const write = (value: unknown) =>
			appendFileSync(
				file,
				`${JSON.stringify({ timestamp: new Date().toISOString(), ...(value as object) }, (_key, item) => (typeof item === "string" ? redact(item) : item))}\n`,
				{ mode: 0o600 },
			);
		const headers = Object.fromEntries(
			[...request.headers].map(([key, value]) => [key, sensitiveHeaders.has(key.toLowerCase()) ? "[REDACTED]" : value]),
		);
		write({
			type: "request",
			url: request.url,
			method: request.method,
			headers,
			body: request.body ? await request.clone().text() : "",
		});
		try {
			const response = await original(request);
			const headers = Object.fromEntries(
				[...response.headers].filter(([key]) => /^(?:x-)?ratelimit-|^retry-after$|^date$/i.test(key)),
			);
			write({ type: "response", status: response.status, headers });
			if (response.body) {
				void (async () => {
					const reader = response.clone().body!.getReader();
					const decoder = new TextDecoder();
					let pending = "";
					let first = true;
					while (true) {
						const { value, done } = await reader.read();
						if (first && value?.byteLength) {
							write({ type: "first_byte" });
							first = false;
						}
						pending += decoder.decode(value, { stream: !done });
						const lines = pending.split("\n");
						pending = lines.pop()!;
						for (const line of lines) write({ type: "sse", line });
						if (done) {
							if (pending) write({ type: "sse", line: pending });
							break;
						}
					}
				})().catch(() => {});
			}
			return response;
		} catch (error) {
			write({ type: "error", error: String(error) });
			throw error;
		}
	};
	return true;
}

export function traceModel(model: Model<Api>, apiKey?: string): void {
	if (!state || !["openai-completions", "openai-responses"].includes(model.api)) return;
	state.bases.add(model.baseUrl);
	if (apiKey) state.secrets.add(apiKey);
}

export function traceCredentials(store: CredentialStore): CredentialStore {
	const collect = (credential: Credential | undefined) => {
		if (credential?.type === "api_key") {
			if (credential.key) state!.secrets.add(credential.key);
			for (const value of Object.values(credential.env ?? {}))
				if (typeof value === "string" && value) state!.secrets.add(value);
		}
		if (credential?.type === "oauth") {
			if (credential.access) state!.secrets.add(credential.access);
			if (credential.refresh) state!.secrets.add(credential.refresh);
		}
		return credential;
	};
	return {
		read: async (...args) => collect(await store.read(...args)),
		list: (...args) => store.list(...args),
		delete: (...args) => store.delete(...args),
		modify: async (id, fn, options) =>
			collect(await store.modify(id, async (value) => collect(await fn(collect(value))), options)),
	};
}
