import { LOCAL_NODE, type NodeConfig, normalizeOrigin } from "../../api/nodes";
import type { NodeFacts } from "../../api/types";
import type { UpdateView } from "../../api/update";
import type { GlobalNotifyPrefs } from "../../lib/prefs";

/** 设置页的一行展示数据；纯函数产出，组件只负责渲染。 */
export interface Row {
	key: string;
	label: string;
	value: string;
}

const onOff = (value: boolean) => (value ? "开" : "关");

/** 版本串：0.3.x 加短 commit。 */
export function versionText(facts: NodeFacts): string {
	return `${facts.version.yonder}${facts.version.commit ? ` (${facts.version.commit.slice(0, 7)})` : ""}`;
}

/** 网关（本机或远程）的事实行。 */
export function gatewayRows(facts: NodeFacts | undefined): Row[] {
	if (!facts) return [];
	const rows: Row[] = [
		{ key: "version", label: "版本", value: versionText(facts) },
		{ key: "kind", label: "连接方式", value: facts.kind === "local" ? "本机" : "远程" },
	];
	if (facts.node) rows.push({ key: "node", label: "节点", value: facts.node.name || facts.node.id });
	rows.push(
		{ key: "granted", label: "权限", value: facts.granted.join(" / ") || "—" },
		{ key: "protocol", label: "协议版本", value: String(facts.protocol) },
		{ key: "methods", label: "可用方法", value: `${Object.keys(facts.methods).length} 个` },
	);
	return rows;
}

/** 账号分区：网关事实 + 社交账号名（空表示未登录）。 */
export function accountRows(facts: NodeFacts | undefined, socialName: string | null | undefined): Row[] {
	return [...gatewayRows(facts), { key: "social", label: "社交账号", value: socialName || "未登录" }];
}

/** 通知分区：全局偏好的当前值。 */
export function notifyRows(prefs: GlobalNotifyPrefs): Row[] {
	return [
		{ key: "enabled", label: "通知", value: onOff(prefs.enabled) },
		{ key: "vibrate", label: "震动", value: onOff(prefs.vibrate) },
		{ key: "previews", label: "消息预览", value: onOff(prefs.previews) },
	];
}

export interface NodeRow {
	id: string;
	name: string;
	origin: string;
	/** 当前选中的节点。 */
	current: boolean;
	/** 本机节点不能删除。 */
	removable: boolean;
}

/** 节点分区：列表行，本机显示为同源。 */
export function nodeRows(nodes: NodeConfig[], activeId: string): NodeRow[] {
	return nodes.map((node) => ({
		id: node.id,
		name: node.name || node.id,
		origin: node.origin ?? "同源（当前页面）",
		current: node.id === activeId,
		removable: node.id !== LOCAL_NODE.id,
	}));
}

export type UpdateAction = "download" | "apply" | "none";

export interface UpdateSummary {
	text: string;
	action: UpdateAction;
	actionLabel?: string;
}

/**
 * 更新分区的文案与可用动作。只有 ready 才给 apply（下载完再出按钮）；
 * 后端没有 update.* 或当前是远程连接时只说明不可用，不冒充可更新。
 */
export function updateSummary(view: UpdateView): UpdateSummary {
	if (!view.available) return { text: view.reason ?? "正在读取节点信息…", action: "none" };
	const state = view.state;
	if (!state) return { text: "正在读取更新状态…", action: "none" };
	switch (state.state) {
		case "idle":
			return {
				text: state.latest && state.latest !== state.current ? `可更新到 ${state.latest}` : "已是最新版本",
				action: "download",
				actionLabel: "检查并下载",
			};
		case "checking":
			return { text: "正在检查更新…", action: "none" };
		case "downloading":
			return { text: "正在后台下载…", action: "none" };
		case "ready":
			return {
				text: state.latest ? `已下载 ${state.latest}，点击应用` : "更新已下载，点击应用",
				action: "apply",
				actionLabel: "应用更新",
			};
		case "applying":
			return { text: "正在应用更新…", action: "none" };
		case "failed":
			return { text: state.error ? `更新失败：${state.error}` : "更新失败", action: "download", actionLabel: "重试" };
		default:
			return { text: "更新不可用", action: "none" };
	}
}

/** 关于分区：版本与更新状态。 */
export function aboutRows(view: UpdateView): Row[] {
	const rows: Row[] = [];
	if (view.facts) rows.push({ key: "version", label: "版本", value: versionText(view.facts) });
	rows.push({ key: "update", label: "更新", value: updateSummary(view).text });
	return rows;
}

/** 添加节点表单的校验：地址可规范化且非空；返回规范化地址或错误文案。 */
export function parseNodeOrigin(input: string): { origin?: string; error?: string } {
	if (!input.trim()) return { error: "填写节点地址" };
	try {
		return { origin: normalizeOrigin(input) };
	} catch (error) {
		return { error: error instanceof Error ? error.message : "节点地址无效" };
	}
}
