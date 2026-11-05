import { afterAll, beforeAll, expect, test } from "vitest";
import { ensureCloudDefinition } from "./definitions.js";
import { migrateDefinitions } from "./schema.js";
import { testPostgres, testPostgresUnavailable } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
const bot = { id: "bot-model", ownerId: "owner-model", name: "小未" };

beforeAll(async () => {
	if (testPostgresUnavailable) return;
	database = await testPostgres();
	await migrateDefinitions(database.pool);
});
afterAll(async () => {
	await database?.close();
});

const stored = async (path: string) =>
	(
		await database.pool.query<{ content: string }>(
			"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path=$3",
			[bot.ownerId, bot.id, path],
		)
	).rows[0]!.content;

test.skipIf(testPostgresUnavailable)(
	"a Bot seeded under an earlier platform model moves to the current one",
	async () => {
		await ensureCloudDefinition(database.pool, bot, "cloud", "deepseek/deepseek-flash");
		const agentPath = `agents/${bot.id}/agent.yaml`;
		expect(await stored(agentPath)).toContain("deepseek/deepseek-flash");

		const config = await ensureCloudDefinition(database.pool, bot, "cloud", "zai/glm-5.3-flash");
		expect(config.defaultModel).toBe("zai/glm-5.3-flash");
		const agent = await stored(agentPath);
		expect(agent).not.toContain("deepseek");
		expect(JSON.parse(agent).profiles.default.model).toBe("zai/glm-5.3-flash");

		const before = await stored(agentPath);
		await ensureCloudDefinition(database.pool, bot, "cloud", "zai/glm-5.3-flash");
		expect(await stored(agentPath)).toBe(before);
	},
);

test.skipIf(testPostgresUnavailable)(
	"memory's owner source follows the real owner DM once the platform names it",
	async () => {
		const owner = { id: "bot-source", ownerId: "owner-source", name: "云端 Bot" };
		const sources = async () =>
			JSON.parse(
				(
					await database.pool.query<{ content: string }>(
						"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path='yonder.yaml'",
						[owner.ownerId, owner.id],
					)
				).rows[0]!.content,
			).plugins.find((plugin: { use: string }) => plugin.use === "@yonder/plugin-memory").config
				.allowedSourceConversations;
		await ensureCloudDefinition(database.pool, owner, "cloud", "zai/glm-5.3-flash");
		expect(await sources()).toEqual([`conv:card:${owner.id}:${owner.ownerId}`]);
		await ensureCloudDefinition(database.pool, { ...owner, ownerConv: "dm-1" }, "cloud", "zai/glm-5.3-flash");
		expect(await sources()).toEqual([`conv:card:${owner.id}:dm-1`]);
	},
);

test.skipIf(testPostgresUnavailable)(
	"visitors get the owner's published card text, replaced in place on change",
	async () => {
		const owner = { id: "bot-card", ownerId: "owner-card", name: "云端 Bot" };
		const instructions = async () =>
			JSON.parse(
				(
					await database.pool.query<{ content: string }>(
						"SELECT content FROM bot_files WHERE tenant_id=$1 AND bot_id=$2 AND path=$3",
						[owner.ownerId, owner.id, `agents/${owner.id}/agent.yaml`],
					)
				).rows[0]!.content,
			).profiles.outsider.instructions as string;
		await ensureCloudDefinition(database.pool, owner, "cloud", "zai/glm-5.3-flash");
		expect(await instructions()).not.toContain("owner-public-card");
		await ensureCloudDefinition(
			database.pool,
			{ ...owner, ownerCard: "姓名：曾子悦\n简介：第一版" },
			"cloud",
			"zai/glm-5.3-flash",
		);
		expect(await instructions()).toContain("简介：第一版");
		await ensureCloudDefinition(
			database.pool,
			{ ...owner, ownerCard: "姓名：曾子悦\n简介：第二版" },
			"cloud",
			"zai/glm-5.3-flash",
		);
		const text = await instructions();
		expect(text).toContain("简介：第二版");
		expect(text).not.toContain("第一版");
		expect(text.match(/<owner-public-card>/g)).toHaveLength(1);
		await ensureCloudDefinition(database.pool, owner, "cloud", "zai/glm-5.3-flash");
		expect(await instructions()).not.toContain("owner-public-card");
	},
);
