import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

test.skipIf(process.env.YONDER_TEST_REAL !== "1").each(["default", "coding"])(
	"PT-01 real supervisor delegates to %s and accepts its result",
	async (preset) => {
		const home = await mkdtemp("/tmp/yonder-pt01-");
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
			kernel = await openKernel(home);
			const running = kernel;
			const sourcePath = join(process.cwd(), "CONTRIBUTING.md");
			const receipt = await running.bots.send(
				"main",
				`请将只读子任务派给 ${preset} 预设：读取 ${sourcePath}，确认文档规定的默认真实测试模型。子任务报告必须以 STATUS: done|partial|blocked 开头，包含路径和模型。收到结果后核对实际证据，正确才在最终答复写“验收通过”，并报告路径和模型。不要修改文件。`,
			);
			const main = (await running.sessions.list({})).find((s) => s.agent === "main")!;
			await expect
				.poll(
					async () => {
						const children = (await running.sessions.list({})).filter(
							(s) => s.parent === main.id && s.profile === preset,
						);
						if (children.length !== 1) return false;
						const events = (await running.events.query({ limit: 1000 })).events;
						const completion = events.find((e) => e.type === "runtime.tool-result" && e.parent === receipt.event);
						const childEnd = events.find(
							(e) => e.type === "run.end" && (e.data as { session?: string }).session === children[0]?.id,
						);
						const parentEnded =
							childEnd &&
							events.some(
								(e) =>
									e.type === "run.end" &&
									e.ts >= childEnd.ts &&
									(e.data as { inputs?: string[] }).inputs?.includes(completion?.id ?? receipt.event),
							);
						const report =
							(await running.sessions.transcript(main.id, { limit: 300 }))
								.filter((e) => e.kind === "pi.assistant")
								.at(-1)?.text ?? "";
						return (
							parentEnded && report.includes("验收通过") && report.includes("gpt-6-luna") && report.includes(sourcePath)
						);
					},
					{ timeout: 210000, interval: 500 },
				)
				.toBe(true);
			const sessions = await running.sessions.list({});
			const children = sessions.filter((s) => s.parent === main.id && s.profile === preset);
			expect(children).toHaveLength(1);
			const evidence = await Promise.all(
				sessions.map(async (s) => ({
					id: s.id,
					parent: s.parent,
					profile: s.profile,
					transcript: await running.sessions.transcript(s.id, { limit: 300 }),
				})),
			);
			const events = (await running.events.query({ limit: 1000 })).events;
			await writeFile(join(home, "evidence.json"), JSON.stringify({ evidence, events }, null, 2));
			const child = evidence.find((e) => e.id === children[0]!.id)!;
			const report = child.transcript.filter((e) => e.kind === "pi.assistant").at(-1)?.text ?? "";
			expect(report).toMatch(/^STATUS: done\b/u);
			expect(report).toContain("gpt-6-luna");
			expect(report).toContain(sourcePath);
			console.info(
				"PT01 acceptance",
				JSON.stringify({ home, preset, report, runs: events.filter((e) => e.type === "run.end").map((e) => e.data) }),
			);
		} finally {
			if (kernel) {
				const sessions = await kernel.sessions.list({});
				const evidence = await Promise.all(
					sessions.map(async (s) => ({
						id: s.id,
						parent: s.parent,
						profile: s.profile,
						transcript: await kernel!.sessions.transcript(s.id, { limit: 300 }),
					})),
				);
				await writeFile(
					join(home, "evidence.json"),
					JSON.stringify({ evidence, events: (await kernel.events.query({ limit: 1000 })).events }, null, 2),
				);
			}
			await kernel?.close();
			await rm(join(home, "auth.json"), { force: true });
			console.info("PT01 evidence directory", home);
		}
	},
	225000,
);
