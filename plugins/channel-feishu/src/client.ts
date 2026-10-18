import type { PluginAPI } from "@yonder/sdk";
import { type Config, type ObjectValue, object, string } from "./protocol.js";

/** A request may have reached Feishu without a conclusive protocol receipt. */
export class FeishuRequestError extends Error {
	constructor(
		message: string,
		readonly uncertain: boolean,
	) {
		super(message);
	}
}
export const uncertain = (error: unknown): boolean => error instanceof FeishuRequestError && error.uncertain;

export class FeishuApi {
	readonly base: string;
	private token = "";
	private expiresAt = 0;
	private secret = "";
	constructor(
		readonly config: Config,
		private readonly api: PluginAPI,
	) {
		this.base = config.domain === "lark" ? "https://open.larksuite.com/open-apis" : "https://open.feishu.cn/open-apis";
	}
	async credentials(): Promise<{ appId: string; appSecret: string }> {
		const value = await this.api.credentials.get(this.config.secret);
		if (value?.type !== "api_key" || !value.key)
			throw new Error(`Feishu credential unavailable: ${this.config.secret}`);
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
		let message = error instanceof Error ? error.message : "Feishu operation failed";
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
		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			throw new FeishuRequestError(`Feishu ${operation}: HTTP ${response.status}`, response.status >= 500);
		}
		const result = object(JSON.parse((await this.bytes(response, 2 * 1024 * 1024)).toString("utf8")));
		if (typeof result.code !== "number") throw new Error(`Feishu ${operation}: malformed response code`);
		if (result.code !== 0) {
			const violations = object(result.error).permission_violations;
			const scopes = Array.isArray(violations) ? violations.map((v) => string(object(v).subject)).filter(Boolean) : [];
			throw new FeishuRequestError(
				`Feishu ${operation}: code=${String(result.code)}${scopes.length ? `; required permissions=${scopes.join(",")}` : ""}; check application scopes, publication and tenant access`,
				false,
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
			throw new FeishuRequestError(this.safe(error), false);
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
			throw new FeishuRequestError(this.safe(error), method !== "GET");
		}
	}
}
