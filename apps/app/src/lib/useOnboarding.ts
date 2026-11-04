import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { $session } from "../store";
import { openOnboarding } from "./onboarding";

/**
 * 账号是否还没有自己的 Bot（引导入口的显示条件）。
 * 联系人没加载完、访客账号、节点没有社交服务时都按「不需要」处理。
 */
export function useNeedsBot(): boolean {
	const me = useStore($session)?.actor;
	const account = me && !me.anonymous ? me.id : undefined;
	const query = useQuery({
		queryKey: ["contacts"],
		queryFn: api.contacts,
		enabled: !!account,
		refetchOnWindowFocus: true,
	});
	const agents = (query.data ?? []).filter((a) => a.kind === "agent" && a.ownerId === me?.id);
	return !!account && query.isSuccess && agents.length === 0;
}

/** 「创建你的 bot」入口的打开动作：需要账号且没有自己的 Bot 才有效。 */
export function useOpenOnboarding(): () => void {
	const needsBot = useNeedsBot();
	return needsBot ? openOnboarding : () => {};
}
