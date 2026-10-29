import type { ShareLink, ShareLinkKind } from "../api/types";

/**
 * 分享链接配额的界面事实：服务端记录 token、已用次数、上限、过期与吊销时间，
 * 这里只把它们换算成「还剩几天、能不能用、该显示哪句话」，不做请求。
 * 状态文案与 lib/verify.ts 的 verifyErrorText 里 share_* 的解释一致。
 */
export type ShareLinkState = "active" | "share_exhausted" | "share_expired" | "share_revoked";

export const SHARE_LINK_STATE_TEXT: Record<ShareLinkState, string> = {
	active: "可用",
	share_exhausted: "名额已用完，请重新生成",
	share_expired: "已过期，请重新生成",
	share_revoked: "已撤销，请重新生成",
};

const DAY_MS = 86_400_000;

export interface ShareLinkView {
	state: ShareLinkState;
	/** 列表里的状态短句 */
	stateText: string;
	/** 剩余天数，向上取整；已过期或吊销为 0 */
	daysLeft: number;
	/** 期限文案；已失效时为空，由 stateText 说明 */
	expiryText: string;
	/** 短显示：前 6 位加省略号 */
	shortToken: string;
	/** 「已用 / 上限」，例如 "3 / 50" */
	usageText: string;
	/** 还能拉新访客（可以继续把二维码发出去） */
	usable: boolean;
}

/** 服务端可能把时间回成非 ISO 字符串；解析失败按已过期处理，避免把坏数据当成永久有效。 */
function expiresAt(link: Pick<ShareLink, "expiresAt">): number {
	const value = Date.parse(link.expiresAt);
	return Number.isFinite(value) ? value : Number.NaN;
}

export function shareLinkView(
	link: Pick<ShareLink, "token" | "usedCount" | "maxUses" | "expiresAt" | "revokedAt">,
	now = Date.now(),
): ShareLinkView {
	const expires = expiresAt(link);
	const remaining = expires - now;
	const expired = !Number.isFinite(expires) || remaining <= 0;
	const daysLeft = expired ? 0 : Math.ceil(remaining / DAY_MS);
	// 吊销优先于过期，过期优先于名额：服务端也是这个顺序（verification.ts 的 lockShare）。
	const state: ShareLinkState = link.revokedAt
		? "share_revoked"
		: expired
			? "share_expired"
			: link.usedCount >= link.maxUses
				? "share_exhausted"
				: "active";
	return {
		state,
		stateText: SHARE_LINK_STATE_TEXT[state],
		daysLeft,
		expiryText: expired ? "" : `还剩 ${daysLeft} 天`,
		shortToken: shortToken(link.token),
		usageText: `${link.usedCount} / ${link.maxUses}`,
		usable: state === "active",
	};
}

export function shortToken(token: string, head = 6): string {
	const text = token.trim();
	return text.length <= head ? text : `${text.slice(0, head)}…`;
}

/**
 * 分享链接的完整地址：配额 token 走 `?share=`，目标页面仍是名片站原路径（/u/、/p/、/g/）。
 *
 * 服务端返回的 url 固定是 `PUBLIC_ORIGIN/?share=<token>`，不指向被分享的名片/群；
 * 直接拿它做二维码会打开站点根页。这里只取其中的 share token，拼到 origin 与目标路径后面：
 * 二维码仍然落到被分享的页面，登录/加入时 Login 与 Composer 能读到 `?share=` 计入配额。
 */
export function shareLinkUrl(link: Pick<ShareLink, "token" | "url">, path: string, origin: string): string {
	let token = link.token;
	if (link.url) {
		try {
			token = new URL(link.url, origin).searchParams.get("share") ?? link.token;
		} catch {}
	}
	return `${origin}${path}?share=${encodeURIComponent(token)}`;
}

/**
 * 服务端没有「按名片/群列出分享链接」的接口（只有按 token 查一条），
 * 主人页只能显示本机生成过的 token：在 localStorage 里按目标记一串 token，再逐个查配额。
 * 只是本地索引，不是服务端事实；换浏览器/设备看不到之前的记录。
 */
export const SHARE_LINK_STORE_KEY = "yonder.shareLinks";
/** 每个目标最多留几条历史，避免吊销/过期的记录无限堆积。 */
export const MAX_SHARE_LINKS_PER_TARGET = 5;

export type ShareLinkRegistry = Record<string, string[]>;

export function shareLinkKey(kind: ShareLinkKind, targetId: string): string {
	return `${kind}:${targetId}`;
}

export function parseShareLinkRegistry(raw: string | null | undefined): ShareLinkRegistry {
	if (!raw) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		const registry: ShareLinkRegistry = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(value)) continue;
			const tokens = [...new Set(value.filter((token): token is string => typeof token === "string" && !!token))];
			if (tokens.length) registry[key] = tokens.slice(0, MAX_SHARE_LINKS_PER_TARGET);
		}
		return registry;
	} catch {
		return {};
	}
}

export function rememberToken(
	registry: ShareLinkRegistry,
	key: string,
	token: string,
	limit = MAX_SHARE_LINKS_PER_TARGET,
): ShareLinkRegistry {
	const clean = token.trim();
	if (!clean) return registry;
	const current = registry[key] ?? [];
	const next = [clean, ...current.filter((item) => item !== clean)].slice(0, Math.max(1, limit));
	return { ...registry, [key]: next };
}

export function forgetToken(registry: ShareLinkRegistry, key: string, token: string): ShareLinkRegistry {
	const next = (registry[key] ?? []).filter((item) => item !== token);
	const copy = { ...registry };
	if (next.length) copy[key] = next;
	else delete copy[key];
	return copy;
}

function readRegistry(): ShareLinkRegistry {
	try {
		return parseShareLinkRegistry(globalThis.localStorage?.getItem(SHARE_LINK_STORE_KEY) ?? null);
	} catch {
		return {};
	}
}

function writeRegistry(registry: ShareLinkRegistry): void {
	try {
		globalThis.localStorage?.setItem(SHARE_LINK_STORE_KEY, JSON.stringify(registry));
	} catch {}
}

/** 本机记录过的 token；没有 localStorage（SSR、隐私模式禁用存储）时为空。 */
export function storedShareTokens(key: string): string[] {
	return [...(readRegistry()[key] ?? [])];
}

export function rememberShareToken(key: string, token: string): string[] {
	const registry = rememberToken(readRegistry(), key, token);
	writeRegistry(registry);
	return [...(registry[key] ?? [])];
}

export function forgetShareToken(key: string, token: string): string[] {
	const registry = forgetToken(readRegistry(), key, token);
	writeRegistry(registry);
	return [...(registry[key] ?? [])];
}
