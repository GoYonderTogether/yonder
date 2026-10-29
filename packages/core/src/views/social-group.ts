import type { ViewDecl, ViewProvider } from "@yonder/sdk";
import type { GroupDisplay } from "../routing/group-session.js";

/** main 显示通道的视图：只列 Bot 群内发言与需关注摘要，不列原始群消息。 */
export const socialDisplayViewId = "core.social.display";

/**
 * 群显示视图。注册点在 `packages/core/src/kernel/index.ts`（本卡未放开该路径），
 * 群会话列表前端另卡（SOC01 G-03）；这里只提供与 `builtinViews` 同形的声明与数据源。
 */
export function socialDisplayView(display: GroupDisplay): { decl: ViewDecl; provider: ViewProvider } {
	const decl: ViewDecl = {
		id: socialDisplayViewId,
		plugin: "core",
		title: "群里",
		placement: "rail",
		scope: "session",
	};
	const provider: ViewProvider = {
		data(session) {
			if (!session) throw new Error("Session required");
			const items = display.items();
			return {
				viewId: decl.id,
				rev: items.length,
				badge: items.filter((item) => item.kind === "attention").length,
				content: {
					type: "list",
					items: items.map((item) => ({
						id: item.id,
						title: item.text,
						subtitle: item.kind === "attention" ? "需要关注" : "群内发言",
						state: item.kind === "attention" ? "info" : "done",
					})),
				},
			};
		},
	};
	return { decl, provider };
}
