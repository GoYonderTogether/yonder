import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { ensureDefaultBot, usePersonalAgent } from "../lib/personalAgent";
import { useSocialService } from "../lib/useWorkEntry";

/** 已登录用户直接进聊天列表；联系人加载完仍没有任何自己的 Bot 时，自动创建默认 Bot「小歪」。 */
export function PersonalAgentGate({ children }: { children: ReactNode }) {
	const { agents, me, isSuccess } = usePersonalAgent();
	const social = useSocialService();
	const qc = useQueryClient();
	const account = me && !me.anonymous ? me.id : undefined;
	const needsBot = social !== "none" && !!account && isSuccess && agents.length === 0;
	useEffect(() => {
		if (!needsBot || !account) return;
		void ensureDefaultBot(account)
			.then(() =>
				Promise.all([qc.invalidateQueries({ queryKey: ["contacts"] }), qc.invalidateQueries({ queryKey: ["convs"] })]),
			)
			.catch(() => {
				/* 下次进入或窗口聚焦刷新联系人时会再试。 */
			});
	}, [needsBot, account, qc]);
	return children;
}
