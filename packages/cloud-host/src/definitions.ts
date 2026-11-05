import { withDefaultOutsider } from "@yonder/bot-core/kernel/peer";
import { parseAgentConfig, parseYonderConfig, type YonderConfig } from "@yonder/bot-definition";
import { PLATFORM_MODEL } from "@yonder/runtime-adapter/postgres";
import type { Pool } from "pg";
import { cloudPlugins } from "./plugins.js";

/** The provider-qualified id a new cloud Bot's config uses for the single platform model. */
export const PLATFORM_MODEL_REF = PLATFORM_MODEL;

export interface CloudBotIdentity {
	id: string;
	name: string;
	ownerId: string;
	/** 平台还没告诉这只 Bot「你已连上主人」时给出的真实主人私聊 id。 */
	greetConv?: string;
}

/** Only missing files are seeded; scaffoldWorkspace uses the shipped default-agent templates. */
export async function ensureCloudDefinition(
	pool: Pool,
	bot: CloudBotIdentity,
	environment: string,
	/** Provider-qualified platform model id; every new Bot's yonder.yaml and profile use it. */
	model: string = PLATFORM_MODEL_REF,
): Promise<YonderConfig> {
	const plugins = cloudPlugins.map((id) => ({
		use: `@yonder/plugin-${id}`,
		...(id === "memory"
			? {
					config: {
						root: `/bots/${encodeURIComponent(bot.id)}/memory`,
						owner: `person:${bot.ownerId}`,
						timezone: "Asia/Shanghai",
						// 记忆工具与上下文只对这只 Bot 的 main 会话开放；主人私聊是唯一的来源会话。
						allowedAgents: [bot.id],
						allowedSourceConversations: [`conv:card:${bot.id}:${bot.greetConv ?? bot.ownerId}`],
						// 主人要求：主人私聊里的原话自动记入记忆（context from each source）。
						capture: { enabled: true, channels: ["card"] },
						// 主人要求：自我画像的上下文预算是 5000 字符（docs/spec/15 §10 默认 2000）。
						context: { meChars: 5000 },
					},
				}
			: {}),
	}));
	const config = {
		schema: 1,
		defaultModel: model,
		locale: "zh-CN",
		timezone: "Asia/Shanghai",
		agents: [{ id: bot.id, workspace: `agents/${bot.id}` }],
		plugins,
		channels: { card: { type: "card" } },
		gateway: { enabled: false },
		identity: { persons: [{ id: bot.ownerId, name: "主人", accounts: [`acct:card:${bot.id}:${bot.ownerId}`] }] },
	};
	const defaults = parseYonderConfig(JSON.stringify(config), "yonder.yaml");
	const agent = {
		schema: 1,
		id: bot.id,
		name: bot.name,
		owner: `person:${bot.ownerId}`,
		defaultProfile: "default",
		profiles: {
			default: {
				model,
				plugins: cloudPlugins,
				capabilities: ["read", "write", "network", "message", "admin"],
				contexts: ["default-agent-soul", "default-agent-work", "memory-core", "memory-week"],
				prompt: { overrides: { "runtime.environment": environment } },
			},
		},
		bindings: [
			{
				id: "owner",
				match: { type: "message.in", channel: "card", kind: "dm", from: "owner" },
				session: "main",
				profile: "default",
				wake: "run",
				reply: "auto",
				stream: false,
			},
			{
				// 每日晨晚报的节律入口：cron 作业发出 cron.morning-brief，绑定把它接进 main，
				// 模型按 memory 插件的 memory-morning-brief skill 汇总；cron 作业把结果投递给主人。
				id: "morning-brief",
				match: { type: "cron.morning-brief" },
				session: "main",
				profile: "default",
				wake: "run",
			},
		],
	};
	await pool.query(
		`INSERT INTO bot_files(tenant_id,bot_id,path,content) VALUES($1,$2,'yonder.yaml',$3),($1,$2,$4,$5)
		ON CONFLICT(tenant_id,bot_id,path) DO NOTHING`,
		[
			bot.ownerId,
			bot.id,
			JSON.stringify(config),
			`agents/${bot.id}/agent.yaml`,
			JSON.stringify(
				withDefaultOutsider(
					parseAgentConfig(JSON.stringify(agent), "agent.yaml", bot.id),
					defaults.outsiders,
					"local",
					defaults.defaultModel,
				),
			),
		],
	);
	await adoptPlatformModel(pool, bot, model);
	const row = (
		await pool.query<{ content: string }>(
			"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path='yonder.yaml'",
			[bot.ownerId, bot.id],
		)
	).rows[0]!;
	return parseYonderConfig(row.content, "yonder.yaml");
}

/**
 * Cloud Bots have no model choice: the worker serves exactly one platform model. A definition seeded under an
 * earlier platform model would name a model this worker cannot resolve, so rewrite every model field to the
 * current one. Fields already on it are left byte-for-byte.
 */
async function adoptPlatformModel(pool: Pool, bot: CloudBotIdentity, model: string): Promise<void> {
	const paths = ["yonder.yaml", `agents/${bot.id}/agent.yaml`];
	const rows = (
		await pool.query<{ path: string; content: string }>(
			"SELECT path, content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path = ANY($3)",
			[bot.ownerId, bot.id, paths],
		)
	).rows;
	for (const row of rows) {
		let changed = false;
		const value = JSON.parse(row.content) as unknown;
		const visit = (node: unknown): void => {
			if (Array.isArray(node)) return node.forEach(visit);
			if (!node || typeof node !== "object") return;
			const record = node as Record<string, unknown>;
			for (const key of ["model", "defaultModel"]) {
				if (typeof record[key] === "string" && record[key] !== model) {
					record[key] = model;
					changed = true;
				}
			}
			Object.values(record).forEach(visit);
		};
		visit(value);
		if (changed)
			await pool.query("UPDATE bot_files SET content=$4 WHERE tenant_id=$1 AND bot_id=$2 AND path=$3", [
				bot.ownerId,
				bot.id,
				row.path,
				JSON.stringify(value),
			]);
	}
}
