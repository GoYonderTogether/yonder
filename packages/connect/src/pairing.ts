/** The pairing flow the Card channel uses: `POST /api/device/start`, poll, then a device token (spec 16 §1). */

export interface PairCode {
	/** Opaque device code, sent back to `/api/device/poll`. */
	code: string;
	/** Page the human confirms on: `<origin>/connect?code=…`. */
	url: string;
}

export interface PairOptions {
	endpoint: string;
	/** Device name shown on the confirmation page. */
	name: string;
	/** `harness` marks a connector-hosted device (spec 16 §5). */
	kind: string;
	signal: AbortSignal;
	fetch?: typeof fetch;
}

const TIMEOUT_MS = 15_000;

/** Ask the cloud for a device code; the browser page confirms which account binds it. */
export async function startPairing(options: PairOptions): Promise<PairCode> {
	const call = options.fetch ?? fetch;
	const response = await call(new URL("/api/device/start", options.endpoint), {
		method: "POST",
		redirect: "error",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: options.name, kind: options.kind }),
		signal: AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]),
	});
	if (response.status !== 201) throw new Error(`获取设备码失败（HTTP ${response.status}）`);
	const body: unknown = await response.json();
	const row = body as { code?: unknown; url?: unknown };
	if (typeof row.code !== "string" || !row.code || typeof row.url !== "string") throw new Error("设备码响应无效");
	return { code: row.code, url: row.url };
}

export type PollResult =
	| { status: "pending" }
	| { status: "confirmed"; deviceToken: string }
	| { status: "invalid" | "used" };

/** One poll of `/api/device/poll`; the device token is returned exactly once. */
export async function pollPairing(
	endpoint: string,
	code: string,
	signal: AbortSignal,
	call: typeof fetch = fetch,
): Promise<PollResult> {
	const url = new URL("/api/device/poll", endpoint);
	url.searchParams.set("code", code);
	const response = await call(url, {
		redirect: "error",
		signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
	});
	if (response.status === 404) return { status: "invalid" };
	if (!response.ok) throw new Error(`轮询设备码失败（HTTP ${response.status}）`);
	const body: unknown = await response.json();
	const row = body as { status?: unknown; deviceToken?: unknown };
	if (row.status === "confirmed" && typeof row.deviceToken === "string" && row.deviceToken)
		return { status: "confirmed", deviceToken: row.deviceToken };
	if (row.status === "pending") return { status: "pending" };
	if (row.status === "used") return { status: "used" };
	return { status: "invalid" };
}

export interface WaitOptions {
	endpoint: string;
	code: string;
	signal: AbortSignal;
	/** Poll interval; the confirmation page is human-paced. */
	intervalMs?: number;
	/** Overall deadline; the device code itself expires after ten minutes. */
	timeoutMs?: number;
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

/** Poll until the human confirms in the browser, the code expires, or the caller aborts. */
export async function waitForPairing(options: WaitOptions): Promise<string> {
	const interval = options.intervalMs ?? 2_000;
	const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000);
	const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	for (;;) {
		if (options.signal.aborted) throw new Error("已取消");
		const result = await pollPairing(options.endpoint, options.code, options.signal, options.fetch);
		if (result.status === "confirmed") return result.deviceToken;
		if (result.status === "invalid" || result.status === "used")
			throw new Error("设备码已失效，请在网页重新添加设备后重试");
		if (Date.now() >= deadline) throw new Error("等待确认超时，请在网页重新添加设备");
		await sleep(interval);
	}
}

/** Validate a cloud base URL: an HTTP(S) origin, plain HTTP only on loopback (same rule as Card). */
export function cloudBase(endpoint: string): string {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error("Yonder 地址必须是 HTTP(S) 源，不含凭据、路径或查询参数");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("Yonder 地址必须是 HTTP(S) 源，不含凭据、路径或查询参数");
	if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
		throw new Error("非本机地址必须使用 HTTPS");
	return url.origin;
}
