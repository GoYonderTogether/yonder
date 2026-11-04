import type { Device, DeviceGrant } from "../../api/types";

/**
 * 设备状态词（spec 19 §5、research/04 §4 流程 1）。四个词不能合并：
 * 在线、离线、离线但有已加载内容、在线但协议过低需要更新。
 */
export type DeviceState = "online" | "offline" | "cached" | "stale";

export function deviceState(device: Pick<Device, "online" | "workProtocol">, cached: boolean): DeviceState {
	if (device.online) return device.workProtocol === 1 ? "online" : "stale";
	return cached ? "cached" : "offline";
}

export const DEVICE_STATE_WORD: Record<DeviceState, string> = {
	online: "在线",
	offline: "离线",
	cached: "离线 · 显示已加载内容",
	stale: "需要更新 Yonder",
};

/** 协议状态与在线状态是两个事实：在线不等于支持工作台。 */
export function protocolWord(device: Pick<Device, "online" | "workProtocol">): string | undefined {
	if (device.workProtocol === 1) return "工作台 v1";
	return device.online ? "工作台未就绪" : undefined;
}

/**
 * 执行端是 18 的授权判定点。harness 连接器按 16 §5 不上报执行端身份，因此它不参与设备执行；
 * 这是它的定义，不是故障，不能显示成「执行端未登记」。
 */
export type ExecutorState = "harness" | "registered" | "unregistered" | "unknown";

export function executorState(device: Pick<Device, "kind" | "online" | "executor">): ExecutorState {
	if (device.kind === "harness") return "harness";
	if (device.executor) return "registered";
	return device.online ? "unregistered" : "unknown";
}

export const EXECUTOR_WORD: Record<ExecutorState, string> = {
	harness: "外部 harness 连接器，不提供设备执行",
	registered: "执行端已登记",
	unregistered: "执行端未登记",
	unknown: "离线，无法确认执行端",
};

/**
 * 一条 grant 是否现在真的允许这个 Bot 执行。撤销过的、已过期的都不算；
 * 只用于显示，授权判定始终在执行端（18 §1）。
 */
export function activeGrant(grant: DeviceGrant, botId: string, now: number = Date.now()): boolean {
	if (grant.botId !== botId || grant.revokedAt) return false;
	const expires = Date.parse(grant.expiresAt);
	return Number.isFinite(expires) ? expires > now : true;
}

/**
 * Bot 详情里每台设备的状态词（research/04 §4 流程 3：四个词不可合并）。
 * `unreported` 是「设备从未上报授权」，不能当成「无 grant」。
 */
export type BotDeviceState = "not-allowed" | "offline" | "unreported" | "no-grant" | "ready";

export function botDeviceState(input: {
	allowed: boolean;
	online: boolean;
	observed: boolean;
	hasGrant: boolean;
}): BotDeviceState {
	if (!input.allowed) return "not-allowed";
	if (!input.online) return "offline";
	if (!input.observed) return "unreported";
	return input.hasGrant ? "ready" : "no-grant";
}

export const BOT_DEVICE_WORD: Record<BotDeviceState, string> = {
	"not-allowed": "未允许此设备",
	offline: "设备离线",
	unreported: "设备未上报授权",
	"no-grant": "无 grant",
	ready: "可执行",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 相对时间；缺失或无法解析时返回 undefined，由调用方决定说什么，不伪造时间。 */
export function relativeTime(iso: string | undefined, now: number = Date.now()): string | undefined {
	if (!iso) return undefined;
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return undefined;
	const diff = now - at;
	if (diff < MINUTE) return "刚刚";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
	const days = Math.floor(diff / DAY);
	if (days < 30) return `${days} 天前`;
	return new Date(at).toLocaleDateString();
}

/** 「最近活动」优先用真实消息时间，其次才是设备最近一次连接；两者都没有就不显示。 */
export function lastActivity(
	device: Pick<Device, "lastActiveAt" | "lastSeenAt">,
	now: number = Date.now(),
): { at: string; label: string } | undefined {
	const active = relativeTime(device.lastActiveAt, now);
	if (active) return { at: device.lastActiveAt!, label: `最近活动 ${active}` };
	const seen = relativeTime(device.lastSeenAt, now);
	return seen ? { at: device.lastSeenAt!, label: `上次连接 ${seen}` } : undefined;
}

export const DEVICE_KIND_WORD: Record<Device["kind"], string> = {
	laptop: "笔记本",
	desktop: "台式机",
	server: "服务器",
	cloud: "云端运行时",
	harness: "外部 harness",
};
