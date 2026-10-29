import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { ModelHealth } from "../runtime/model-health.js";
import { ModelQuota } from "../runtime/model-quota.js";
import { initHome, inspectHome } from "./home.js";

test("doctor advises old SiliconFlow homes to set system role compatibility", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-doctor-siliconflow-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.models = {
			providers: {
				siliconflow: {
					api: "openai-completions",
					baseUrl: "https://api.siliconflow.cn/v1",
					models: [{ id: "deepseek-ai/DeepSeek-V3.2" }],
				},
			},
		};
		await writeFile(file, stringify(config));
		expect((await inspectHome(home)).warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("supportsDeveloperRole: false")]),
		);
		config.models.providers.siliconflow.compat = { supportsDeveloperRole: false };
		await writeFile(file, stringify(config));
		expect((await inspectHome(home)).warnings).not.toEqual(
			expect.arrayContaining([expect.stringContaining("supportsDeveloperRole: false")]),
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);

test("doctor advises rightapi-glm homes to set systemAsUser compatibility", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-doctor-glm-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.models = {
			providers: {
				"rightapi-glm": {
					api: "openai-completions",
					baseUrl: "https://www.rightapi.ai/v1",
					models: [{ id: "glm-5.3-flash" }],
				},
			},
		};
		await writeFile(file, stringify(config));
		expect((await inspectHome(home)).warnings).toEqual(
			expect.arrayContaining([expect.stringContaining("systemAsUser: true")]),
		);
		config.models.providers["rightapi-glm"].compat = { systemAsUser: true };
		await writeFile(file, stringify(config));
		expect((await inspectHome(home)).warnings).not.toEqual(
			expect.arrayContaining([expect.stringContaining("systemAsUser: true")]),
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);

test("doctor reports configured chain and persisted hold and quota gates", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-doctor-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const agent = parse(await readFile(file, "utf8"));
		const provider = testModel.slice(0, testModel.indexOf("/"));
		agent.defaults.fallback = { models: [], accounts: { [provider]: ["other"] }, quotaStopPercent: { other: 50 } };
		await writeFile(file, stringify(agent));
		const health = new ModelHealth(join(home, ".yonder/model-health.json"));
		await health.hold([`${testModel}@default`], "unavailable", 600, 60);
		const quota = new ModelQuota(join(home, ".yonder/model-quota.json"));
		quota.recordWindow(`${provider}@other`, {
			usedPercent: 80,
			windowMinutes: 300,
			resetsAt: Date.now() + 60000,
			updatedAt: Date.now(),
		});
		await quota.flush();
		const report = await inspectHome(home);
		expect(report.errors).toEqual([]);
		const chain = report.modelChains?.find((item) => item.profile === "main/owner");
		expect(chain?.entries).toEqual([
			expect.objectContaining({
				model: testModel,
				slot: "default",
				held: true,
				quotaBlocked: false,
				holdUntil: expect.any(Number),
				probeAt: expect.any(Number),
			}),
			expect.objectContaining({ model: testModel, slot: "other", held: false, quotaBlocked: true }),
		]);
		quota.recordWindow(`${provider}@other`, {
			usedPercent: 80,
			windowMinutes: 300,
			resetsAt: Date.now() - 1,
			updatedAt: Date.now() + 1,
		});
		await quota.flush();
		const refreshed = await inspectHome(home);
		expect(refreshed.modelChains?.find((item) => item.profile === "main/owner")?.entries).toEqual([
			expect.objectContaining({ slot: "default", held: true, startOrder: 2 }),
			expect.objectContaining({ slot: "other", quotaBlocked: false, startOrder: 1 }),
		]);
		await rm(join(home, ".yonder/model-health.json"));
		await mkdir(join(home, ".yonder/model-health.json"));
		const unavailable = await inspectHome(home);
		expect(unavailable.ok).toBe(false);
		expect(unavailable.errors).toEqual(
			expect.arrayContaining([expect.stringContaining("model chain state unavailable")]),
		);
		expect(unavailable.modelChains).toBeUndefined();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);
