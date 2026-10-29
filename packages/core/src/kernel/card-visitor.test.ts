import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { loadYonderConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import { cardVisitorGaps, migrateCardVisitor } from "./card-visitor.js";
import { initHome, inspectHome } from "./home.js";

test("已有 home 缺 card-visitor 时 doctor 报告，迁移补上、先写 .bak、再跑不动", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-card-visitor-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const config = await loadYonderConfig(home);
		expect(Object.values(config.channels ?? {}).some((c) => (c as { type?: string }).type === "card")).toBe(true);
		const file = join(home, "agents/main/agent.yaml");
		const agent = parse(await readFile(file, "utf8"));
		agent.bindings = agent.bindings.filter((b: { id: string }) => b.id !== "card-visitor");
		await writeFile(file, stringify(agent));

		expect(await cardVisitorGaps(home, config)).toHaveLength(1);
		expect(
			(await inspectHome(home)).warnings.some((w) => w.includes("yonder doctor --fix") && w.includes("card-visitor")),
		).toBe(true);

		const done = await migrateCardVisitor(home, config);
		expect(done).toHaveLength(1);
		expect((await readdir(join(home, "agents/main"))).some((f) => f.startsWith("agent.yaml.bak-"))).toBe(true);
		const fixed = parse(await readFile(file, "utf8"));
		expect(fixed.bindings.filter((b: { id: string }) => b.id === "card-visitor")).toHaveLength(1);
		expect(await cardVisitorGaps(home, config)).toHaveLength(0);

		const before = await readFile(file, "utf8");
		expect(await migrateCardVisitor(home, config)).toHaveLength(0);
		expect(await readFile(file, "utf8")).toBe(before);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);
