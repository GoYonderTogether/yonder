import { realpathSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { manageCredentialSlots } from "./credentials.js";
import { initHome, inspectHome } from "./home.js";

const workbuddy = {
	api: "openai-completions",
	baseUrl: "http://127.0.0.1:8788/v1",
	models: [{ id: "deepseek-v4.1-flash" }],
};
const model = "workbuddy/deepseek-v4.1-flash";
const dead = "整条模型链都跑不通";

async function homeWithChain(slots: string[]) {
	const home = await mkdtemp(join(realpathSync(tmpdir()), "yonder-doctor-dead-chain-"));
	await initHome(home, "owner", { model: testModel });
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.defaultModel = model;
	config.models = { providers: { workbuddy } };
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	if (slots.length) {
		const agentFile = join(home, "agents/main/agent.yaml");
		const agent = parse(await readFile(agentFile, "utf8"));
		agent.defaults.fallback = { models: [], accounts: { workbuddy: slots } };
		await writeFile(agentFile, stringify(agent));
	}
	return home;
}

test("doctor does not call an undeclared provider's missing login a dead chain", async () => {
	const home = await mkdtemp(join(realpathSync(tmpdir()), "yonder-doctor-undeclared-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const report = await inspectHome(home);
		expect(report.ok).toBe(true);
		expect(report.errors).toEqual([]);
		expect(report.warnings).not.toEqual(expect.arrayContaining([expect.stringContaining(dead)]));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);

test("doctor reports a dead chain when every declared candidate has no usable credential", async () => {
	const home = await homeWithChain([]);
	try {
		const report = await inspectHome(home);
		expect(report.ok).toBe(false);
		expect(report.errors.find((error) => error.includes(dead))).toContain("没有可用凭据");
		const chain = report.modelChains?.find((item) => item.profile === "main/owner");
		expect(chain?.entries).toEqual([expect.objectContaining({ model, slot: "default", credentialMissing: true })]);
		// A named slot replaces nothing: the main model's default slot is still the first candidate.
		const withSlot = await homeWithChain(["other"]);
		try {
			const named = await inspectHome(withSlot);
			expect(named.errors.find((error) => error.includes(dead))).toContain("workbuddy/deepseek-v4.1-flash@other");
			// 凭据槽只接受 0700 目录，tmp home 的 .yonder 是 0755，先收紧再创建。
			await chmod(join(withSlot, ".yonder"), 0o700);
			await manageCredentialSlots(withSlot, "create", "workbuddy", "other", "YONDER_TEST_WORKBUDDY_KEY");
			process.env.YONDER_TEST_WORKBUDDY_KEY = "sk-test";
			const configured = await inspectHome(withSlot);
			const entries = configured.modelChains?.find((item) => item.profile === "main/owner")?.entries ?? [];
			expect(entries).toEqual([
				expect.objectContaining({ slot: "default", credentialMissing: true }),
				expect.objectContaining({ slot: "other", held: false, quotaBlocked: false }),
			]);
			expect(entries[1]).not.toHaveProperty("credentialMissing");
			delete process.env.YONDER_TEST_WORKBUDDY_KEY;
			// Once the provider is no longer declared, the same home stops being judged as a dead chain.
			const config = parse(await readFile(join(withSlot, "yonder.yaml"), "utf8"));
			config.models = undefined;
			await writeFile(join(withSlot, "yonder.yaml"), stringify(config));
			expect((await inspectHome(withSlot)).errors).not.toEqual(expect.arrayContaining([expect.stringContaining(dead)]));
		} finally {
			await rm(withSlot, { recursive: true, force: true });
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 120000);
