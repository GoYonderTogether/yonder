/**
 * `yonder init` 的发行包（design §5.4）。只列插件 id 与渠道实例，复用 init 的写入路径。
 * core 不含任何渠道，只保证任务会话可用；default 是加载但默认只启用 cli 的日常集；
 * full 含全部随包插件。
 */
import { join } from "node:path";
import type { YonderConfig } from "./config/index.js";
import { pluginDirectory } from "./plugins/index.js";

export type BundleId = "core" | "default" | "full";

/** init 已知的值：memory 之类必填主人级配置的插件用它填默认（全部自动行为仍关闭）。 */
interface BundleContext {
	home: string;
	owner: string;
	timezone: string;
}

interface BundlePlugin {
	use: string;
	config?: (context: BundleContext) => unknown;
}

export interface Bundle {
	plugins: BundlePlugin[];
	channels: Record<string, { type: string }>;
}

/** 随包提供、默认不启用的第三方渠道：发行时一起安装，init 不写入 yonder.yaml。 */
export const shippedChannels = [
	{ type: "feishu", plugin: "@yonder/plugin-channel-feishu" },
	{ type: "wechat-ilink", plugin: "@yonder/plugin-channel-wechat-ilink" },
	{ type: "qq", plugin: "@yonder/plugin-channel-qq" },
	{ type: "github", plugin: "@yonder/plugin-channel-github" },
] as const;

/** 第一档：默认启用；core 是其中无渠道的最小集。 */
const corePlugins = [
	{ use: "@yonder/plugin-context-files" },
	{ use: "@yonder/plugin-interaction" },
	{ use: "@yonder/plugin-agent-presets" },
	{ use: "@yonder/plugin-web-tools" },
	{ use: "@yonder/plugin-learning" },
];

const core: Bundle = { plugins: corePlugins, channels: {} };

/** 设计 §5.4 的默认加载集：渠道 cli、channel-mcp（不监听）、channel-card（未登录空闲）与本机小插件。 */
const defaults: Bundle = {
	plugins: [
		{ use: "@yonder/plugin-channel-cli" },
		...corePlugins,
		{ use: "@yonder/plugin-channel-mcp" },
		{ use: "@yonder/plugin-channel-card" },
		{ use: "@yonder/plugin-cron" },
		{ use: "@yonder/plugin-tasks" },
		{ use: "@yonder/plugin-onboarding" },
		{ use: "@yonder/plugin-mcp-client" },
		// 记忆根目录放在 home 下、所有 agent 工作区之外；触发器与采集默认关闭，白名单为空。
		{
			use: "@yonder/plugin-memory",
			config: ({ home, owner, timezone }) => ({ root: join(home, "memory"), owner: `person:${owner}`, timezone }),
		},
	],
	channels: { cli: { type: "cli" } },
};

/** 需要主人级插件配置、init 无法替主人选择的渠道：只能 plugins add 显式加入并写配置。 */
const needsOwnerConfig = new Set(["@yonder/plugin-channel-wechat-ilink"]);

/** 第三档：可选插件仅在显式选择 full 时加载；secrets 需单独安装。session 工具属于内核，不是插件。 */
const full: Bundle = {
	plugins: [
		...defaults.plugins,
		...shippedChannels.filter(({ plugin }) => !needsOwnerConfig.has(plugin)).map(({ plugin }) => ({ use: plugin })),
		{ use: "@yonder/plugin-clipboard" },
		{ use: "@yonder/plugin-native-automation" },
		{ use: "@yonder/plugin-browser-skill" },
		{ use: "@yonder/plugin-wechat-archive" },
		{ use: "@yonder/plugin-codex-tools" },
		{ use: "@yonder/plugin-media-tools" },
		{ use: "@yonder/plugin-devices" },
		{ use: "@yonder/plugin-market" },
	],
	channels: defaults.channels,
};

export const bundles: Record<BundleId, Bundle> = { core, default: defaults, full };

export const bundleIds = Object.keys(bundles) as BundleId[];

export function bundleFor(id: string): Bundle {
	if (!bundleIds.includes(id as BundleId)) throw new Error(`Unknown bundle ${id}; choose ${bundleIds.join(", ")}`);
	return bundles[id as BundleId];
}

/**
 * 随包提供、但当前没有同 type 实例的第三方渠道。只列本次安装里插件实际可解析的项，
 * 单独成列，不改动已配置渠道的条目（channels.list 保持原样）。
 */
export async function shippedDisabledChannels(
	enabledTypes: Iterable<string | undefined>,
	resolvable: (plugin: string) => Promise<boolean>,
) {
	const types = new Set(enabledTypes);
	const candidates = shippedChannels.filter(({ type }) => !types.has(type));
	const found = await Promise.all(
		candidates.map(async (channel) => ((await resolvable(channel.plugin)) ? channel : undefined)),
	);
	return found
		.filter((channel) => channel !== undefined)
		.map(({ type, plugin }) => ({ type, plugin, status: "随包提供，未启用 · Shipped, not enabled" }));
}

/** 本次安装里实际可解析的随包未启用渠道；`yonder.yaml.channels` 已有同 type 实例的不再列出。 */
export const shippedChannelsFor = (home: string, config: YonderConfig) =>
	shippedDisabledChannels(
		Object.values(config.channels ?? {}).map((channel) => channel.type),
		(plugin) =>
			pluginDirectory(home, plugin).then(
				() => true,
				() => false,
			),
	);
