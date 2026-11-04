import { withDefaultOutsider } from "@yonder/bot-core/kernel/peer";
import { parseAgentConfig, parseYonderConfig, type YonderConfig } from "@yonder/bot-definition";
import { PLATFORM_MODEL, PLATFORM_PROVIDER } from "@yonder/runtime-adapter/postgres";
import type { Pool } from "pg";
import { cloudPlugins } from "./plugins.js";

/** The provider-qualified id a new cloud Bot's config uses for the single platform model. */
export const PLATFORM_MODEL_REF = `${PLATFORM_PROVIDER}/${PLATFORM_MODEL}`;

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
				contexts: ["default-agent-soul", "default-agent-work"],
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
	const row = (
		await pool.query<{ content: string }>(
			"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path='yonder.yaml'",
			[bot.ownerId, bot.id],
		)
	).rows[0]!;
	return parseYonderConfig(row.content, "yonder.yaml");
}
