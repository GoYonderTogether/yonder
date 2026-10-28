import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

test.skipIf(!process.env.YONDER_TEMPLATE_AUTH)(
	"real console input expands a Bot template",
	async () => {
		const home = await mkdtemp("/tmp/yonder-template-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = process.env.YONDER_TEMPLATE_AUTH;
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
			await mkdir(join(home, "agents/main/prompts"));
			await writeFile(join(home, "agents/main/prompts/check.md"), "Reply with exactly $1 and nothing else.");
			kernel = await openKernel(home);
			const running = kernel;
			const sent = await running.bots.send("main", "/check TEMPLATE_VERIFIED");
			await expect
				.poll(
					async () => {
						const events = (await running.events.query({ type: "run.end", limit: 100 })).events;
						return events.find(
							(event) =>
								event.parent === sent.event || (event.data as { inputs?: string[] }).inputs?.includes(sent.event),
						);
					},
					{ timeout: 90_000 },
				)
				.toBeTruthy();
			const outputs = (await kernel.events.query({ type: "message.out", limit: 100 })).events;
			expect(JSON.stringify(outputs)).toContain("TEMPLATE_VERIFIED");
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	120_000,
);
