/** 市场云端（`/api/market`）客户端：Bearer 设备令牌、统一错误码。 */

const TIMEOUT = 20000;

const STATUS: Record<number, string> = {
	400: "invalid_request",
	401: "unauthorized",
	403: "forbidden",
	404: "not_found",
	409: "conflict",
	413: "payload_too_large",
	429: "rate_limited",
	503: "rate_limit_unavailable",
};

function marketUrl(base: string, path: string): URL {
	try {
		return new URL(`${base}/api/market${path}`);
	} catch {
		throw new Error("market endpoint is not a valid URL");
	}
}

export interface MarketCall {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	query?: Record<string, string | number | boolean | undefined>;
	body?: Record<string, unknown>;
}

export type MarketResult = { ok: true; body: unknown } | { ok: false; error: string; status?: number };

export class MarketClient {
	constructor(
		private readonly base: string,
		private readonly token: string,
	) {}

	async call(call: MarketCall, signal?: AbortSignal): Promise<MarketResult> {
		const url = marketUrl(this.base, call.path);
		for (const [key, value] of Object.entries(call.query ?? {}))
			if (value !== undefined) url.searchParams.set(key, String(value));
		const signals = [AbortSignal.timeout(TIMEOUT)];
		if (signal) signals.push(signal);
		let response: Response;
		try {
			response = await fetch(url, {
				method: call.method,
				headers: {
					authorization: `Bearer ${this.token}`,
					accept: "application/json",
					...(call.body ? { "content-type": "application/json" } : {}),
				},
				...(call.body ? { body: JSON.stringify(call.body) } : {}),
				signal: AbortSignal.any(signals),
			});
		} catch (error) {
			throw new Error(`market cloud request failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const text = await response.text();
		let parsed: unknown;
		try {
			parsed = text ? JSON.parse(text) : undefined;
		} catch {
			parsed = undefined;
		}
		if (response.status >= 400) {
			const code = (parsed as { error?: unknown } | undefined)?.error;
			const fallback = STATUS[response.status] ?? "invalid_request";
			return { ok: false, error: typeof code === "string" && code ? code : fallback, status: response.status };
		}
		return { ok: true, body: parsed };
	}
}

/** 云端地址跟随社交云端（yonder-cloud）默认值，末尾斜杠归一化。 */
export function endpointOf(value: unknown): string {
	if (value === undefined) return "https://yonderbot.net";
	if (typeof value !== "string" || !value.trim()) throw new Error("endpoint must be an http(s) URL");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("endpoint must be an http(s) URL");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
		throw new Error("endpoint must be an http(s) URL");
	return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
