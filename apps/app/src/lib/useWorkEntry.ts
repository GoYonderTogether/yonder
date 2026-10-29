import { useQuery } from "@tanstack/react-query";
import { socialOrigin } from "../api/http";
import { RpcError, rpc } from "../work/api/client";
import type { NodeFacts } from "../work/api/types";
import { featureContext, featureVisible } from "../work/capabilities/features";
import { appBase, gatewayHosted } from "./base";

/**
 * 「工作」入口是否显示：由能力表（work/capabilities/features.ts 的 work）决定。
 * 网关存在但未登录（unauthorized）也显示，让用户进去登录；没有网关（请求失败、非网关响应）则隐藏。
 */
export function useWorkEntry(): boolean {
	// 云端构建（VITE_API=http）且不是网关托管：同源没有网关，不去请求 /api/rpc/capabilities.get（JV2-J14-01）。
	const noLocalGateway = import.meta.env.VITE_API === "http" && !gatewayHosted();
	const probe = useQuery({
		enabled: !noLocalGateway,
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

/**
 * 探一次同源网关与社交服务：网关用应用挂载路径（/console/api/…），社交服务用 api/http.ts 同一个源站
 * （缺省根，VITE_SOCIAL_BASE 可改）。两者混用会把网关注入的 401 当成「社交服务在线」。
 */
export async function probeSocialService(): Promise<SocialService> {
	let gatewayReachable = false;
	try {
		await rpc("capabilities.get");
		gatewayReachable = true;
		// 已登录的网关挂在非根路径（如线上 /console/）：这是网关控制台，源站根上的同域名社交服务不是它的一部分。
		// 否则粘贴令牌登录后会落到社交登录页（JV2-J07-05）。
		if (appBase() !== "/") return "none";
	} catch (error) {
		gatewayReachable = error instanceof RpcError && error.code === "unauthorized";
	}
	if (!gatewayReachable) return "present";
	let sessionStatus: number | null = null;
	try {
		sessionStatus = (await fetch(new URL("api/session", socialOrigin()))).status;
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
