import { useQuery } from "@tanstack/react-query";
import { RpcError, rpc } from "../work/api/client";
import type { NodeFacts } from "../work/api/types";
import { featureContext, featureVisible } from "../work/capabilities/features";
import { appBase } from "./base";

/**
 * 「工作」入口是否显示：由能力表（work/capabilities/features.ts 的 work）决定。
 * 网关存在但未登录（unauthorized）也显示，让用户进去登录；没有网关（请求失败、非网关响应）则隐藏。
 */
export function useWorkEntry(): boolean {
	const probe = useQuery({
		queryKey: ["work-gateway"],
		staleTime: 5 * 60_000,
		retry: false,
		refetchOnWindowFocus: false,
		queryFn: async (): Promise<"facts" | "login" | "none"> => {
			try {
				const facts = await rpc<NodeFacts>("capabilities.get");
				return featureVisible("work", featureContext({ gatewayAuthed: true, facts })).state === "show"
					? "facts"
					: "none";
			} catch (error) {
				return error instanceof RpcError && error.code === "unauthorized" ? "login" : "none";
			}
		},
	});
	return probe.data === "facts" || probe.data === "login";
}

export type SocialService = "pending" | "present" | "none";

/**
 * 网关托管的构建没有社交服务：同源网关可达（capabilities.get 正常或 401），且 /api/session 为 404。
 * 其余情况（含开发预览的 vite + mock）保持原行为。
 */
export function socialServiceOf(probe: { gatewayReachable: boolean; sessionStatus: number | null }): SocialService {
	return probe.gatewayReachable && probe.sessionStatus === 404 ? "none" : "present";
}

async function probeSocialService(): Promise<SocialService> {
	let gatewayReachable = false;
	try {
		await rpc("capabilities.get");
		gatewayReachable = true;
	} catch (error) {
		gatewayReachable = error instanceof RpcError && error.code === "unauthorized";
	}
	if (!gatewayReachable) return "present";
	let sessionStatus: number | null = null;
	try {
		sessionStatus = (await fetch(new URL("api/session", new URL(appBase(), location.origin)))).status;
	} catch {
		/* 保持 null：按有社交服务处理 */
	}
	return socialServiceOf({ gatewayReachable, sessionStatus });
}

/** VITE_API=http 明确配置了社交服务；否则探测一次同源网关。 */
export function useSocialService(): SocialService {
	const configured = import.meta.env.VITE_API === "http";
	const probe = useQuery({
		queryKey: ["social-service"],
		enabled: !configured,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
		refetchOnWindowFocus: false,
		queryFn: probeSocialService,
	});
	if (configured) return "present";
	return probe.data ?? "pending";
}
