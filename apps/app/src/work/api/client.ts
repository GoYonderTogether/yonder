import { appBase } from "../../lib/base";
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
 * 一个网关节点（API-R20）。缺省是当前页面的同源网关；远程节点给 origin，
 * 可选 token 先换该节点的登录 cookie。id 只用于 query key 与 UI 区分。
 */
export interface NodeTarget {
	id?: string;
	/** 绝对地址，可带挂载路径（如 https://host:7690/console）；缺省同源。 */
	origin?: string;
	/** 远程节点访问令牌，仅用于 POST <origin>/login 换 cookie。 */
	token?: string;
}

/**
 * 同源接口按应用挂载路径（lib/base 的 appBase，网关注入的 yonder-base-path）解析，与当前路由深度无关：
 * 本机 basePath="/" → /api/…；线上 /console/ → /console/api/…（反代剥掉前缀）。
 * 鉴权是网关签发的 HttpOnly cookie，前端不保存令牌。
 */
const baseOf = (node?: NodeTarget) =>
	node?.origin
		? new URL(node.origin.endsWith("/") ? node.origin : `${node.origin}/`)
		: new URL(appBase(), location.origin);

const remote = (node?: NodeTarget) => (node?.origin ? { credentials: "include" as const } : {});

/** 未登录监听：任一请求 401 时通知外壳切到登录页。 */
const authListeners = new Set<() => void>();
export const onUnauthorized = (fn: () => void) => {
	authListeners.add(fn);
	return () => void authListeners.delete(fn);
};

export async function rpc<T>(
	method: string,
	params: unknown = {},
	signal?: AbortSignal,
	node?: NodeTarget,
): Promise<T> {
	const res = await fetch(new URL(`api/rpc/${method}`, baseOf(node)), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(params),
		signal,
		...remote(node),
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

/** 用访问令牌（或一次性票据）换登录 cookie；远程节点用该节点自己的 origin。 */
export async function login(token: string, node?: NodeTarget): Promise<void> {
	const res = await fetch(new URL("login", baseOf(node)), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token }),
		...remote(node),
	});
	if (res.status === 429) throw new RpcError("unavailable", "尝试次数过多，请一分钟后再试", 429);
	if (!res.ok) throw new RpcError("forbidden", "令牌无效", res.status);
}

export async function logout(): Promise<void> {
	await fetch(new URL("api/logout", baseOf()), { method: "POST" });
}

export function wsUrl(node?: NodeTarget): string {
	const u = new URL("api/stream", baseOf(node));
	u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
	u.searchParams.set("v", "1");
	return u.toString();
}

export type { ServerFrame };
