import type { PluginAPI } from "@yonder/sdk";
import { type Config, type ObjectValue, object, string } from "./protocol.js";
import { scopeHint } from "./scopes.js";

/** A request may have reached Feishu without a conclusive protocol receipt. */
export class FeishuRequestError extends Error {
	constructor(
		message: string,
		readonly uncertain: boolean,
		readonly retryable = false,
	) {
		super(message);
	}
}
const transport = (error: unknown, beforeDispatch = false): boolean => {
	let current = error;
	for (let depth = 0; current instanceof Error && depth < 4; depth++, current = current.cause) {
		// HTTPS request bytes cannot be sent before the TLS handshake completes.
		if (
			(current as NodeJS.ErrnoException).code === "ECONNRESET" &&
			current.message.includes("before secure TLS connection was established")
		)
			return true;
		if (
			/^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT)$/.test(
				String((current as NodeJS.ErrnoException).code),
			)
		)
			return true;
		if (beforeDispatch && /fetch failed|ECONNRESET|ETIMEDOUT|connection error/i.test(current.message)) return true;
	}
	return false;
};
export const uncertain = (error: unknown): boolean => error instanceof FeishuRequestError && error.uncertain;

export class FeishuApi {
	private local = "";
	private token = "";
	private expiresAt = 0;
	private secret = "";
	constructor(
		readonly config: Config,
		private readonly api: PluginAPI,
	) {}
	get base(): string {
		return this.config.domain === "lark" ? "https://open.larksuite.com/open-apis" : "https://open.feishu.cn/open-apis";
	}
	/** Adopt credentials created by one-click app registration; they never enter config or logs. */
	adopt(appId: string, appSecret: string, domain: "feishu" | "lark"): void {
		this.config.appId = appId;
		this.config.domain = domain;
		this.local = appSecret;
		this.secret = appSecret;
		this.token = "";
		this.expiresAt = 0;
	}
	get configured(): boolean {
		return Boolean(this.config.appId && (this.local || this.config.secret));
	}
	async credentials(): Promise<{ appId: string; appSecret: string }> {
		if (this.local) {
			this.secret = this.local;
			return { appId: this.config.appId, appSecret: this.local };
		}
		let value: Awaited<ReturnType<PluginAPI["credentials"]["get"]>>;
		try {
			value = await this.api.credentials.get(this.config.secret);
		} catch {
			throw new Error("Feishu credential lookup failed; check the credential store");
		}
		if (value?.type !== "api_key" || !value.key)
			throw new Error(
				"Feishu credential unavailable: configure a credential name and store an api_key with yonder credentials set",
			);
		this.secret = value.key;
		return { appId: this.config.appId, appSecret: value.key };
	}
	clear(): void {
		this.token = "";
		this.secret = "";
		this.expiresAt = 0;
	}
	safe(error: unknown): string {
		// Never stringify SDK request/config objects; they can contain app_secret and bearer tokens.
		const details: string[] = [];
		let current = error;
		const seen = new Set<unknown>();
		while (current instanceof Error && !seen.has(current) && seen.size < 4) {
			seen.add(current);
			const code = (current as NodeJS.ErrnoException).code;
			details.push(
				`${current.name === "Error" ? "" : `${current.name}: `}${current.message}${code ? ` [${code}]` : ""}`,
			);
			current = current.cause;
		}
		let message = details.length
			? details.join("; cause: ")
			: typeof error === "string"
				? error
				: "Feishu operation failed";
		message = message
			.replace(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
			.replace(/(Bearer\s+)\S+/gi, "$1[redacted]")
			.replace(
				/((?:app_secret|appSecret|access_token|tenant_access_token|token|ticket)[\s"']*[:=][\s"']*)[^\s,"'&}]+/gi,
				"$1[redacted]",
			);
		for (const value of [this.secret, this.token]) if (value) message = message.split(value).join("[redacted]");
		return message;
	}
	async bytes(response: Response, maximum: number): Promise<Buffer> {
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Feishu response has no body");
		let size = 0;
		const buffers: Buffer[] = [];
		try {
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.byteLength;
				if (size > maximum) throw new Error(`Feishu resource exceeds ${maximum} bytes`);
				buffers.push(Buffer.from(next.value));
			}
		} catch (error) {
			await reader.cancel().catch(() => {});
			throw error;
		} finally {
			reader.releaseLock();
		}
		return Buffer.concat(buffers);
	}
	private async json(response: Response, operation: string): Promise<ObjectValue> {
		let result: ObjectValue;
		try {
			result = object(JSON.parse((await this.bytes(response, 2 * 1024 * 1024)).toString("utf8")));
		} catch (error) {
			if (response.ok) throw error;
			throw new FeishuRequestError(`Feishu ${operation}: HTTP ${response.status}`, response.status >= 500);
		}
		if (!response.ok && typeof result.code !== "number")
			throw new FeishuRequestError(`Feishu ${operation}: HTTP ${response.status}`, response.status >= 500);
		if (typeof result.code !== "number") throw new Error(`Feishu ${operation}: malformed response code`);
		if (!response.ok || result.code !== 0) {
			const violations = object(result.error).permission_violations;
			const scopes = Array.isArray(violations) ? violations.map((v) => string(object(v).subject)).filter(Boolean) : [];
			const hint =
				result.code === 99991672 || result.code === 99991679 ? scopeHint(this.config.domain, this.config.appId) : "";
			throw new FeishuRequestError(
				// The hint holds only a fixed console URL, so it is appended after URL redaction.
				`${this.safe(
					new Error(
						`Feishu ${operation}: ${response.ok ? "" : `HTTP ${response.status}; `}code=${String(result.code)}${string(result.msg) ? `; msg=${string(result.msg)}` : ""}${scopes.length ? `; required permissions=${scopes.join(",")}` : ""}${result.code !== 0 ? "; check application scopes, publication and tenant access" : ""}`,
					),
				)}${hint}`,
				!response.ok && response.status >= 500,
			);
		}
		return result;
	}
	private async access(signal?: AbortSignal): Promise<string> {
		if (this.token && Date.now() < this.expiresAt - 60000) return this.token;
		const credentials = await this.credentials();
		const response = await fetch(`${this.base}/auth/v3/tenant_access_token/internal`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }),
			redirect: "error",
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
		});
		const result = await this.json(response, "authentication");
		const token = string(result.tenant_access_token);
		if (!token) throw new Error("Feishu authentication omitted tenant token");
		this.token = token;
		this.expiresAt = Date.now() + Math.max(0, Number(result.expire) || 0) * 1000;
		return token;
	}
	async request(path: string, method = "GET", body?: object | FormData, signal?: AbortSignal): Promise<ObjectValue> {
		const response = await this.raw(path, method, body, signal);
		try {
			return await this.json(response, path.split("?")[0] ?? path);
		} catch (error) {
			if (error instanceof FeishuRequestError) throw error;
			throw new FeishuRequestError(this.safe(error), method !== "GET");
		}
	}
	async raw(path: string, method = "GET", body?: object | FormData, signal?: AbortSignal): Promise<Response> {
		if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid Feishu API path");
		signal?.throwIfAborted();
		let token: string;
		try {
			token = await this.access(signal);
		} catch (error) {
			// Authentication failed before dispatching this operation.
			throw new FeishuRequestError(this.safe(error), false, transport(error, true));
		}
		signal?.throwIfAborted();
		const encoded = body instanceof FormData ? body : body ? JSON.stringify(body) : undefined;
		try {
			return await fetch(`${this.base}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
				},
				...(encoded ? { body: encoded } : {}),
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
			});
		} catch (error) {
			throw new FeishuRequestError(this.safe(error), method !== "GET" && !transport(error), transport(error));
		}
	}
}
