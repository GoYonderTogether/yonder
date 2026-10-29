import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateApplyResult, UpdateState } from "@yonder/gateway/protocol";
import { rpc } from "./client";
import { qk } from "./keys";
import { LOCAL_NODE, type NodeConfig } from "./nodes";
import type { NodeFacts } from "./types";

/**
 * 更新能力来自网关 update.*（contracts §17）：三方法都是 local:true，远程连接永远看不到，
 * 也不得让远程连接操作本机更新。后端尚未注册这些方法时，这里只返回明确的不可用，
 * 不能伪造 ready 或在界面冒充可更新。
 */
export interface UpdateView {
	/** 节点事实（与更新状态同一个 capabilities.get）；不可用或未返回时 undefined。 */
	facts: NodeFacts | undefined;
	/** 可查询时是网关的 UpdateState（首次结果回来前为 undefined）；不可用时也是 undefined。 */
	state: UpdateState | undefined;
	/** 只有节点事实 kind=local 且 update.status 已注册才为 true。 */
	available: boolean;
	/** available=false 时的原因，直接展示给用户。 */
	reason: string | undefined;
}

const targetOf = (node: NodeConfig) => (node.id === LOCAL_NODE.id ? undefined : node);

export function useUpdateState(node: NodeConfig = LOCAL_NODE): UpdateView {
	const isLocal = node.id === LOCAL_NODE.id;
	const facts = useQuery({
		queryKey: qk.capabilities(node.id),
		queryFn: () => rpc<NodeFacts>("capabilities.get", {}, undefined, targetOf(node)),
		enabled: isLocal,
	});
	const has = !!facts.data && "update.status" in facts.data.methods;
	const local = facts.data?.kind === "local";
	const state = useQuery({
		queryKey: qk.update(node.id),
		queryFn: () => rpc<UpdateState>("update.status", {}, undefined, targetOf(node)),
		enabled: isLocal && has && local,
		retry: false,
		refetchInterval: (query) => {
			const s = query.state.data?.state;
			return s === "checking" || s === "downloading" || s === "applying" ? 2000 : false;
		},
	});
	// 远程节点不查询、也不碰本机更新。
	if (!isLocal) return { facts: undefined, state: undefined, available: false, reason: "远程节点不能操作本机更新" };
	if (!facts.data)
		return {
			facts: undefined,
			state: undefined,
			available: false,
			reason: facts.isError ? facts.error.message : undefined,
		};
	if (!local) return { facts: facts.data, state: undefined, available: false, reason: "远程连接不能操作本机更新" };
	if (!has) return { facts: facts.data, state: undefined, available: false, reason: "当前网关没有提供更新方法" };
	return { facts: facts.data, state: state.data, available: true, reason: undefined };
}

/** 后台下载：download 内先检查版本，完成后状态变 ready；下载完不自动应用。 */
export function useDownloadUpdate(node: NodeConfig = LOCAL_NODE) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: () => rpc<UpdateState>("update.download", {}, undefined, targetOf(node)),
		onSuccess: (next) => client.setQueryData(qk.update(node.id), next),
	});
}

/** 应用已下载的更新；必须由用户点击触发。 */
export function useApplyUpdate(node: NodeConfig = LOCAL_NODE) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: () => rpc<UpdateApplyResult>("update.apply", {}, undefined, targetOf(node)),
		onSuccess: () => void client.invalidateQueries({ queryKey: qk.update(node.id) }),
	});
}
