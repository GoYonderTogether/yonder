import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"Chinese task discovers a deferred tool by name and the next run restores the starting tools",
	async () => {
		const home = await mkdtemp("/tmp/yonder-tool-discovery-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.plugins.push({ use: "@yonder/plugin-cron" });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const offer = ["read", "write", "edit", "bash", "grep", "process", "skill_view", "parent_ask", "task_continue"];
			await writeFile(
				`${home}/presets/discovery.yaml`,
				stringify({
					schema: 1,
					description: "Tool discovery acceptance",
					model: "openai/gpt-6-luna",
					level: "standard",
					plugins: ["cron"],
					skills: [],
					tools: { offer, search: ["*"] },
				}),
			);
			kernel = await openKernel(home);
			const running = kernel;
			const session = await running.sessions.open({ preset: "discovery", close: "manual" });
			const tools = () => {
				const db = new DatabaseSync(`${home}/.yonder/state.db`, { readOnly: true });
				try {
					const row = db
						.prepare(
							"SELECT r.content FROM pi_document_revisions r JOIN pi_documents d ON d.id=r.document_id WHERE json_extract(d.record,'$.kind')='pi.agent' AND d.owner_id=? ORDER BY r.seq DESC LIMIT 1",
						)
						.get(Number(session.id));
					return (JSON.parse(String(row?.content)).modelTools as string[]).sort();
				} finally {
					db.close();
				}
			};
			const run = async (text: string) => {
				const receipt = await running.terminal.submit(session.id, { text });
				await expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", after: receipt.event })).events.find(
								(event) => event.parent === receipt.event,
							)?.data,
						{ timeout: 120000, interval: 500 },
					)
					.toMatchObject({ status: "done" });
			};
			await run(
				"请用定时任务管理能力，只读列出当前会话的定时任务。不要创建、修改、运行或删除任务，不运行终端命令，不发消息，也不要展示任务内容；完成后简短报告。",
			);
			const transcript = await running.sessions.transcript(session.id);
			const calls = transcript.flatMap((entry) => entry.tools ?? []);
			expect(calls.map((call) => call.name)).toEqual(["tool_search", "cron_manage"]);
			expect(calls[0]?.args).toMatchObject({ query: "cron_manage", limit: 1 });
			expect(calls[1]?.args).toMatchObject({ action: "list" });
			expect(tools()).toEqual([...offer, "tool_search", "cron_manage"].sort());
			await run("这是下一轮独立输入。不要调用工具，只回复已收到。");
			expect(tools()).toEqual([...offer, "tool_search"].sort());
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	240000,
);
