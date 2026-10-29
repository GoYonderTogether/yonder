import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, inspectHome } from "./home.js";

const DEPRECATED = "@yonder/plugin-hermes-experience";
const CURRENT = "@yonder/plugin-learning";

async function homeWithLearning() {
	const home = await mkdtemp(join(tmpdir(), "yonder-doctor-deprecated-"));
	await initHome(home, "owner", { model: testModel });
	return home;
}

async function swapLearning(home: string, to: { use: string; id: string }) {
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	const from = to.use === DEPRECATED ? CURRENT : DEPRECATED;
	config.plugins = config.plugins.map((plugin: { use: string }) =>
		plugin.use === from ? { ...plugin, use: to.use } : plugin,
	);
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	const agentFile = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(agentFile, "utf8"));
	agent.defaults.plugins = agent.defaults.plugins.map((id: string) =>
		id === "learning" || id === "hermes-experience" ? to.id : id,
	);
	await writeFile(agentFile, stringify(agent));
}

test("doctor gives deprecated plugin homes the yonder migrate path", async () => {
	const home = await homeWithLearning();
	try {
		await swapLearning(home, { use: DEPRECATED, id: "hermes-experience" });
		const report = await inspectHome(home);
		expect(report.errors).toEqual([]);
		expect(report.warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("hermes-experience 已弃用：运行 yonder migrate")]),
		);
		expect(report.warnings).toEqual(
			expect.arrayContaining([expect.stringContaining(".yonder/plugins/hermes-experience")]),
		);
		// 换回替代插件后不再有迁移提示：提示只跟着 package.json 的 deprecated 标记走。
		await swapLearning(home, { use: CURRENT, id: "learning" });
		const current = await inspectHome(home);
		expect(current.errors).toEqual([]);
		expect(current.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining("yonder migrate")]));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 120000);
