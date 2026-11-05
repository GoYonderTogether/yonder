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
