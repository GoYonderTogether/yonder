import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

test.skipIf(process.env.YONDER_TEST_REAL !== "1")(
	"PT-01 real supervisor delegates and handles a short question",
	async () => {
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
			const send = async (text: string) => {
				const receipt = await running.bots.send("main", text);
				await expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", limit: 1000 })).events.find(
								(e) => e.parent === receipt.event || (e.data as { inputs?: string[] }).inputs?.includes(receipt.event),
							),
						{ timeout: 120000, interval: 500 },
					)
					.toBeTruthy();
				return receipt;
			};
			await send("请直接回答：2 加 3 等于多少？");
			const main = (await running.sessions.list({})).find((s) => s.agent === "main")!;
			const shortCalls = (await running.sessions.transcript(main.id)).flatMap((e) => e.tools ?? []).map((t) => t.name);
			console.info("PT01 short calls", JSON.stringify(shortCalls));
			expect(shortCalls.filter((n) => n.startsWith("tasks_"))).toEqual([]);
			await send(
				`请分派一个只读任务：读取 ${process.cwd()}/CONTRIBUTING.md，确认文档规定的默认真实测试模型。取得执行者结果后核对并报告文件路径和模型名。不要修改文件。`,
			);
			const sessions = await running.sessions.list({});
			const children = sessions.filter((s) => s.parent);
			const evidence = await Promise.all(
				sessions.map(async (s) => ({
					id: s.id,
					parent: s.parent,
					transcript: await running.sessions.transcript(s.id, { limit: 300 }),
				})),
			);
			const events = (await running.events.query({ type: "run.end", limit: 1000 })).events;
			await writeFile(join(home, "evidence.json"), JSON.stringify({ evidence, events }, null, 2));
			console.info(
				"PT01 evidence",
				home,
				JSON.stringify({ children: children.length, events: events.map((e) => e.data) }),
			);
			expect(children.length).toBeGreaterThan(0);
			const child = evidence.find((e) => e.parent)!;
			const report = child.transcript.filter((e) => e.kind === "pi.assistant").at(-1)?.text ?? "";
			console.info("PT01 child report", report);
			expect(report).toMatch(/^STATUS: (done|partial|blocked)\b/u);
			const parent = evidence.find((e) => e.id === main.id)!;
			console.info("PT01 parent final", parent.transcript.filter((e) => e.kind === "pi.assistant").at(-1)?.text);
		} finally {
			await kernel?.close();
			await rm(join(home, "auth.json"), { force: true });
			console.info("PT01 evidence directory", home);
		}
	},
	240000,
);
