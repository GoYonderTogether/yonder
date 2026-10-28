import type { ServerFrame } from "./types";

export class RpcError extends Error {
	constructor(
		public code: string,
		message: string,
		public status = 200,
	) {
		super(message);
	}
}

/**
 * 网关会给 index.html 注入 <base href=basePath>，所有接口用相对地址按它解析：
 * 本机 basePath="/" → /api/…；线上 /console/ → /console/api/…（反代剥掉前缀）。
 * 鉴权是网关签发的 HttpOnly cookie，前端不保存令牌。
 */
const at = (path: string) => new URL(path, document.baseURI);

/** 未登录监听：任一请求 401 时通知外壳切到登录页。 */
const authListeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => {
	authListeners.add(fn);
	return () => void authListeners.delete(fn);
};

export async function rpc<T>(method: string, params: unknown = {}, signal?: AbortSignal): Promise<T> {
	const res = await fetch(at(`api/rpc/${method}`), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(params),
		signal,
	});
	if (res.status === 401) {
		for (const fn of authListeners) fn();
		throw new RpcError("unauthorized", "登录已失效，请重新粘贴访问令牌", res.status);
	}
	let body: { ok: boolean; result?: T; error?: { code: string; message: string } };
	try {
		body = await res.json();
	} catch {
		throw new RpcError("unavailable", `网关返回了无法解析的内容（HTTP ${res.status}）`, res.status);
	}
	if (!body.ok) throw new RpcError(body.error?.code ?? "error", body.error?.message ?? "请求失败", res.status);
	return body.result as T;
}

/** 用访问令牌（或一次性票据）换登录 cookie。 */
export async function login(token: string): Promise<void> {
	const res = await fetch(at("login"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token }),
	});
	if (res.status === 429) throw new RpcError("unavailable", "尝试次数过多，请一分钟后再试", 429);
	if (!res.ok) throw new RpcError("forbidden", "令牌无效", res.status);
}

export async function logout(): Promise<void> {
	await fetch(at("api/logout"), { method: "POST" });
}

export function wsUrl(): string {
	const u = at("api/stream");
	u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
	u.searchParams.set("v", "1");
	return u.toString();
}

export type { ServerFrame };
