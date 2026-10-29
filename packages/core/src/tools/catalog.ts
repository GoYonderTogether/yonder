import type { Capability } from "@yonder/sdk";

export const coreToolCapabilities: Record<string, Capability[]> = {
	permissions: [],
	message_send: [],
	agent_ask: ["message"],
	parent_ask: [],
	task_run: [],
	task_control: [],
	task_continue: [],
	session_list: ["admin"],
	session_read: ["admin"],
	identity_lookup: ["read"],
	identity_link: ["admin"],
	// Workbench tools (contracts §18) are optional and gate themselves by session kind, so they carry no capability.
	session_archive: [],
	session_hand_up: [],
	bot_ask: [],
	bot_request: [],
	bot_attach: [],
	skill_view: [],
	process: [],
};

/**
 * 懒加载分组（X7）：属于这些分组的工具默认不进常驻工具表，只有 tool_search 命中或显式激活后才载入。
 * 先只登记代码智能这一组：它一个插件就有十几个工具，常驻会挤掉真正用得上的工具。
 */
export const lazyGroupMatchers: Record<string, (name: string) => boolean> = {
	"code-intel": (name) => name.startsWith("code-intel_"),
};
/** 默认懒加载的分组；配置 `tools.lazyGroups` 可以增减，空数组表示全部常驻。 */
export const defaultLazyGroups: string[] = ["code-intel"];
/** 工具名所属的懒加载分组；不属于任何分组时返回 `undefined`。 */
export function lazyGroupOf(name: string, groups: readonly string[] = defaultLazyGroups): string | undefined {
	return groups.find((group) => lazyGroupMatchers[group]?.(name));
}
