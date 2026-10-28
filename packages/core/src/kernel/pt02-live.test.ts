import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(process.env.YONDER_TEST_REAL !== "1")(
	"real model discovers and invokes find",
	async () => {
		const home = await mkdtemp("/tmp/yonder-p048-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const source = JSON.parse(
				await readFile("/Users/zoran/.local/share/yonder-harness/home/.yonder/auth.json", "utf8"),
			);
			if (source.siliconflow?.type !== "api_key" || typeof source.siliconflow.key !== "string")
				throw Error("siliconflow slot unavailable");
			const auth = join(home, "auth.json");
			await writeFile(auth, JSON.stringify({ siliconflow: source.siliconflow }), { mode: 0o600 });
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
			config.models = {
				providers: {
					siliconflow: {
						baseUrl: "https://api.siliconflow.cn/v1",
						api: "openai-completions",
						authHeader: true,
						models: [
							{
								id: "deepseek-ai/DeepSeek-V3.2",
								name: "DeepSeek V3.2",
								input: ["text"],
								contextWindow: 131072,
								maxTokens: 8192,
							},
						],
					},
				},
			};
			await writeFile(join(home, "yonder.yaml"), stringify(config));
			const agentPath = join(home, "agents/main/agent.yaml");
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: [], search: ["find"] };
			await writeFile(agentPath, stringify(agent));
			kernel = await openKernel(home);
			const receipt = await kernel.bots.send(
				"main",
				'First use tool_search to discover find, then call find with pattern "*.ts" and path "/Users/zoran/Documents/yonder-harness/packages/core/src/runtime" and limit 5. Report the result.',
			);
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "run.end", after: receipt.event })).events.find(
							(e) => e.parent === receipt.event,
						)?.data,
					{ timeout: 120000, interval: 500 },
				)
				.toMatchObject({ status: "done" });
			const session = (await kernel.sessions.list({})).find((s) => s.agent === "main");
			expect(session).toBeTruthy();
			const calls = (await kernel.sessions.transcript(session!.id)).flatMap((e) => e.tools ?? []);
			expect(calls.map((t) => t.name)).toEqual(["tool_search", "find"]);
			console.log("PT02 real model: search then find; run done");
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	150000,
);
