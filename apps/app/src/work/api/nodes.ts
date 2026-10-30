import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { login, type NodeTarget, rpc } from "./client";
import type { NodeFacts } from "./types";

/**
 * 一个已保存的网关节点（API-R20）。`local` 是当前页面的同源网关，永远存在、不可删除。
 * 远程节点只存地址；token 仅用于添加时换该节点的登录 cookie。
 */
export interface NodeConfig {
	id: string;
	name: string;
	/** 绝对地址，可带挂载路径（如 https://host:7690/console）；本机节点没有。 */
	origin?: string;
	deviceId?: string;
}

/** 本机（同源）节点的固定 id；query key 首段、默认节点都用它。 */
export const LOCAL_NODE: NodeConfig = { id: "local", name: "本机" };
/** capabilities.get 的 protocol 版本（contracts §5）；不一致就拒绝添加。 */
export const SUPPORTED_PROTOCOL = 1;

const KEY = "yonder.nodes";
const ACTIVE_KEY = "yonder.nodes.active";

interface NodesState {
	nodes: NodeConfig[];
	active: string;
}

function isNode(value: unknown): value is NodeConfig {
	if (!value || typeof value !== "object") return false;
	const node = value as Partial<NodeConfig>;
	return typeof node.id === "string" && node.id !== "" && typeof node.name === "string";
}

function load(): NodesState {
	let stored: NodeConfig[] = [];
	let wanted = LOCAL_NODE.id;
	try {
		const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		if (Array.isArray(raw))
			stored = raw.filter(isNode).flatMap(({ id, name, origin }) => {
				if (id === LOCAL_NODE.id) return [LOCAL_NODE];
				try {
					return origin ? [{ id, name, origin: normalizeOrigin(origin) }] : [];
				} catch {
					return [];
				}
			});
		if (Array.isArray(raw)) localStorage.setItem(KEY, JSON.stringify(stored));
		wanted = localStorage.getItem(ACTIVE_KEY) ?? LOCAL_NODE.id;
	} catch {
		// 没有 localStorage（SSR、测试或隐私模式）时只保留本机节点。
		stored = [];
	}
	const nodes = stored.some((node) => node.id === LOCAL_NODE.id) ? stored : [LOCAL_NODE, ...stored];
	return { nodes, active: nodes.some((node) => node.id === wanted) ? wanted : LOCAL_NODE.id };
}

/** 首次访问时才读存储：模块 import 不依赖 localStorage 存在。 */
let state: NodesState | undefined;
const current = (): NodesState => (state ??= load());
const listeners = new Set<() => void>();
function commit(next: NodesState) {
	state = next;
	try {
		localStorage.setItem(KEY, JSON.stringify(next.nodes.filter((node) => !node.deviceId)));
		localStorage.setItem(ACTIVE_KEY, next.active);
	} catch {
		// 存储不可用（隐私模式）时只在内存里生效，页面仍可工作。
	}
	for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => void listeners.delete(fn);
};
const nodesOf = () => current().nodes;
const activeOf = () => {
	const { nodes, active } = current();
	return nodes.find((node) => node.id === active) ?? LOCAL_NODE;
};

/** 当前节点列表（非 hook；测试与 store 读取用）。 */
export const nodeList = (): NodeConfig[] => nodesOf();
/** 当前选中节点（非 hook）。 */
export const activeNode = (): NodeConfig => activeOf();

/** 已保存的节点列表，本机恒在首位。 */
export const useNodes = (): NodeConfig[] => useSyncExternalStore(subscribe, nodesOf, nodesOf);
/** 当前选中的节点；列表里找不到时退回本机。 */
export const useActiveNode = (): NodeConfig => useSyncExternalStore(subscribe, activeOf, activeOf);

export function setActiveNode(id: string) {
	const nodes = current().nodes;
	if (!nodes.some((node) => node.id === id)) return;
	commit({ nodes, active: id });
}

/** 账号设备只驻留内存，不复用其他账号的上次选择。 */
export function setCloudDevice(accountId: string, device: { id: string; name: string }) {
	const before = current();
	const node: NodeConfig = { id: `account:${accountId}:device:${device.id}`, name: device.name, deviceId: device.id };
	if (before.active === node.id) return;
	commit({ nodes: [...before.nodes.filter((item) => !item.deviceId), node], active: node.id });
}

/** 规范化远程地址：必须 http(s)，去掉结尾斜杠，保留挂载路径。 */
export function normalizeOrigin(input: string): string {
	const text = input.trim();
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		throw new Error("节点地址要写成 http(s)://主机:端口");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("节点地址要写成 http(s)://主机:端口");
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}`;
}

export interface AddNodeInput {
	origin: string;
	token?: string;
}

/**
 * 添加节点：先按给的令牌登录该节点，再用 capabilities.get 校验协议版本并读真实 node.id。
 * 协议不符或 id 已存在都拒绝，不写入列表。
 */
export async function addNode(input: AddNodeInput): Promise<NodeConfig> {
	const origin = normalizeOrigin(input.origin);
	const target: NodeTarget = { origin };
	if (input.token) await login(input.token, target);
	const facts = await rpc<NodeFacts>("capabilities.get", {}, undefined, target);
	if (facts.protocol !== SUPPORTED_PROTOCOL)
		throw new Error(`节点协议版本 ${facts.protocol} 与客户端 ${SUPPORTED_PROTOCOL} 不一致`);
	const id = facts.node?.id;
	if (!id) throw new Error("节点没有返回 node.id，无法添加");
	if (current().nodes.some((node) => node.id === id)) throw new Error(`节点 ${facts.node.name || id} 已经添加过`);
	const node: NodeConfig = {
		id,
		name: facts.node.name || id,
		origin,
	};
	const before = current();
	commit({ nodes: [...before.nodes, node], active: before.active });
	return node;
}

/** 删除节点并清掉它的查询缓存；本机节点不可删除。 */
export function removeNode(id: string, client?: QueryClient) {
	if (id === LOCAL_NODE.id) return;
	const before = current();
	commit({
		nodes: before.nodes.filter((node) => node.id !== id),
		active: before.active === id ? LOCAL_NODE.id : before.active,
	});
	client?.removeQueries({ predicate: (query) => query.queryKey[0] === id });
}
