import { useQuery } from "@tanstack/react-query";
import { readShell, type Shell } from "../capabilities/facts";
import { type FeatureId, type FeatureVisibility, featureContext, featureVisible } from "../capabilities/features";
import { rpc } from "./client";
import { qk } from "./keys";
import { LOCAL_NODE, type NodeConfig } from "./nodes";
import type { NodeFacts } from "./types";

/**
 * capabilities.get 的前端入口（T-API-16）：节点事实只在这里取一次，
 * 功能判定交给 capabilities/features.ts 的纯函数，判定顺序按 contracts §12。
 */

const targetOf = (node: NodeConfig) => (node.id === LOCAL_NODE.id ? undefined : node);

/** 当前节点的能力事实；远程节点带 origin 与 cookie，本机节点同源。 */
export function useCapabilities(node: NodeConfig = LOCAL_NODE) {
	return useQuery({
		queryKey: qk.capabilities(node.id),
		queryFn: () => rpc<NodeFacts>("capabilities.get", {}, undefined, targetOf(node)),
	});
}

/** 本连接的方法表里有没有这个方法（NodeFacts.methods 已按 scope 与 local 过滤）。 */
export function useHasMethod(name: string, node: NodeConfig = LOCAL_NODE): boolean {
	const facts = useCapabilities(node).data;
	return !!facts && name in facts.methods;
}

export interface UseFeatureInput {
	/** 客户端壳；缺省读注入的 window.__YONDER_SHELL__。 */
	shell?: Shell;
	socialAuthed?: boolean;
	socialAnonymous?: boolean;
}

export interface FeatureGate extends FeatureVisibility {
	/** state === "show" 的简写，供只需要布尔的调用方使用。 */
	visible: boolean;
}

/**
 * 一个功能现在是否可用。节点事实来自 useCapabilities；事实未到时节点相关功能一律隐藏
 * （不给原因），客户端相关功能（如顶栏）不受影响。
 *
 * gatewayAuthed 直接取自 capabilities.get 是否成功：拿得到事实就说明这条连接已登录。
 */
export function useFeature(
	feature: FeatureId,
	input: UseFeatureInput = {},
	node: NodeConfig = LOCAL_NODE,
): FeatureGate {
	const facts = useCapabilities(node).data;
	const ctx = featureContext({
		shell: input.shell ?? readShell(),
		gatewayAuthed: !!facts,
		socialAuthed: input.socialAuthed,
		socialAnonymous: input.socialAnonymous,
		facts,
	});
	const result = featureVisible(feature, ctx);
	return { ...result, visible: result.state === "show" };
}
