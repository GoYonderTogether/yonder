/**
 * `yonder init` 的发行包（design §5.4）。只列插件 id 与渠道实例，复用 init 的写入路径。
 * core 不含任何渠道，只保证任务会话可用；default 是加载但默认只启用 cli 的日常集；
 * full 含全部随包插件。
 */
export type BundleId = "core" | "default" | "full";

export interface Bundle {
	plugins: Array<{ use: string }>;
	channels: Record<string, { type: string }>;
}

/** 随包提供、默认不启用的第三方渠道：发行时一起安装，init 不写入 yonder.yaml。 */
export const shippedChannels = [
	{ type: "feishu", plugin: "@yonder/plugin-channel-feishu" },
	{ type: "wechat-ilink", plugin: "@yonder/plugin-channel-wechat-ilink" },
	{ type: "qq", plugin: "@yonder/plugin-channel-qq" },
	{ type: "github", plugin: "@yonder/plugin-channel-github" },
] as const;

const defaults: Bundle = {
	plugins: [
		{ use: "@yonder/plugin-channel-cli" },
		{ use: "@yonder/plugin-context-files" },
		{ use: "@yonder/plugin-ui-companion" },
		{ use: "@yonder/plugin-agent-presets" },
		{ use: "@yonder/plugin-web-tools" },
		{ use: "@yonder/plugin-channel-mcp" },
	],
	channels: { cli: { type: "cli" } },
};

/** 无渠道核心：去掉渠道插件后 init 仍能写出可用预设与工作区。 */
const core: Bundle = {
	plugins: defaults.plugins.filter(
		({ use }) => use !== "@yonder/plugin-channel-cli" && use !== "@yonder/plugin-channel-mcp",
	),
	channels: {},
};

/** 需要主人级插件配置、init 无法替主人选择的插件：只能 plugins add 显式加入并写配置。 */
const needsOwnerConfig = new Set(["@yonder/plugin-channel-wechat-ilink", "@yonder/plugin-memory"]);

const full: Bundle = {
	plugins: [
		...defaults.plugins,
		{ use: "@yonder/plugin-channel-card" },
		...shippedChannels.filter(({ plugin }) => !needsOwnerConfig.has(plugin)).map(({ plugin }) => ({ use: plugin })),
		{ use: "@yonder/plugin-clipboard" },
		{ use: "@yonder/plugin-native-automation" },
		{ use: "@yonder/plugin-browser-skill" },
		{ use: "@yonder/plugin-wechat-archive" },
		{ use: "@yonder/plugin-codex-tools" },
		{ use: "@yonder/plugin-media-tools" },
		{ use: "@yonder/plugin-mcp-client" },
		{ use: "@yonder/plugin-cron" },
		{ use: "@yonder/plugin-tasks" },
		{ use: "@yonder/plugin-hermes-experience" },
		{ use: "@yonder/plugin-devices" },
	],
	channels: defaults.channels,
};

export const bundles: Record<BundleId, Bundle> = { core, default: defaults, full };

export const bundleIds = Object.keys(bundles) as BundleId[];

export function bundleFor(id: string): Bundle {
	if (!bundleIds.includes(id as BundleId)) throw new Error(`Unknown bundle ${id}; choose ${bundleIds.join(", ")}`);
	return bundles[id as BundleId];
}

/** 已启用实例原样返回，再补上同 type 尚无实例的随包渠道（随包提供，未启用）。 */
export function withShippedChannels<T extends { type?: string | undefined }>(enabled: T[]) {
	const types = new Set(enabled.map((channel) => channel.type));
	return [
		...enabled,
		...shippedChannels
			.filter(({ type }) => !types.has(type))
			.map(({ type, plugin }) => ({ type, plugin, status: "随包提供，未启用 · Shipped, not enabled" })),
	];
}
