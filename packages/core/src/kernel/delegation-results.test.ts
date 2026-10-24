import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { openDatabase } from "../runtime/db.js";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"same Feishu source delegates twice: both fresh results reach prepared context and continue without another input",
	async () => {
		const home = await mkdtemp("/tmp/yonder-delegation-results-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
			const commands = [1, 2].map(
				(n) =>
					`sleep 17; node -e 'const token=require("node:crypto").randomUUID();require("node:fs").writeFileSync("${home}/child-${n}.txt",token);process.stdout.write("RESULT_${n}="+token)'`,
			);
			const workerTasks = commands.map(
				(cmd) =>
					`Run bash exactly once, command: ${cmd}. If it returns a background handle, end this response with WORKER_WAITING and rely on its automatic completion. When the background result arrives, return the actual RESULT line verbatim, without extra text. A waiting progress response is not the delegated task result.`,
			);
			const prompt = `Delegate the following two tasks to helper using agent_ask, sequentially, one at a time. Task 1: ${workerTasks[0]}\nTask 2: ${workerTasks[1]}\nWhen agent_ask returns a running background handle, end this response with WAITING and wait for its automatic completion. Never poll process or ask the user to continue. On completion 1, write its actual full RESULT_1 line to ${home}/parent-1.txt, then delegate task 2. On completion 2, write its actual full RESULT_2 line to ${home}/parent-2.txt and reply DELEGATION_DONE. Never repeat task 1 after receiving task 2. The random RESULT values do not exist until helper executes the commands.`;
			await mkdir(`${home}/source`);
			await writeFile(`${home}/source/input.json`, JSON.stringify({ msgId: `om_${randomUUID()}`, text: prompt }));
			await writeFile(
				`${home}/source/package.json`,
				JSON.stringify({
					name: "delegation-source-check",
					version: "1.0.0",
					type: "module",
					yonder: {
						apiVersion: 1,
						id: "delegation-check",
						entry: "index.mjs",
						contributes: { channels: ["delegation-source"] },
					},
				}),
			);
			// Protocol ingress driver only. The real kernel/router/agents/model/tools,
			// SQLite and background scheduler run; no production Feishu connection.
			await writeFile(
				`${home}/source/index.mjs`,
				`import {readFile,appendFile} from 'node:fs/promises';
export default {setup(api){api.channels.register({type:'delegation-source',create(id){return {id,kinds:['dm'],output:{stream:false,attachments:false},async start(io){const input=JSON.parse(await readFile('${home}/source/input.json','utf8'));await io.emit({type:'message.in',from:'acct:feishu:owner',conv:'conv:feishu:acceptance',data:{kind:'dm',...input}})},async stop(){},async send(to,message){await appendFile('${home}/deliveries.jsonl',JSON.stringify({to,text:message.text})+'\\n');return {ok:true}}}}})}};`,
			);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.plugins.push({ use: "./source" });
			config.channels = { feishu: { type: "delegation-source" } };
			config.identity.persons[0].accounts = ["acct:feishu:owner"];
			config.agents.push({ id: "helper", workspace: "./agents/helper" });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const path = `${home}/agents/main/agent.yaml`;
			const parent = parse(await readFile(path, "utf8"));
			parent.defaults.contexts = [];
			parent.profiles.owner.tools = { offer: ["agent_ask", "write"] };
			parent.bindings.find((binding: { id: string }) => binding.id === "owner")!.match.channel = "feishu";
			await writeFile(path, stringify(parent));
			await mkdir(`${home}/agents/helper`);
			await writeFile(
				`${home}/agents/helper/agent.yaml`,
				stringify({
					schema: 1,
					id: "helper",
					name: "helper",
					owner: "person:owner",
					defaultProfile: "answer",
					profiles: {
						answer: {
							model: "openai/gpt-6-luna",
							thinking: "low",
							level: "standard",
							tools: { offer: ["bash", "process"] },
						},
					},
					bindings: [
						{
							id: "internal",
							match: { channel: "agent", kind: "agent" },
							session: "ephemeral",
							profile: "answer",
							reply: "none",
						},
					],
				}),
			);
			kernel = await openKernel(home);
			await expect.poll(() => existsSync(`${home}/parent-2.txt`), { timeout: 240000 }).toBe(true);
			const running = kernel;
			await expect
				.poll(
					async () =>
						(await running.events.query({ type: "message.out" })).events.some((e) =>
							(e.data as { text: string }).text.includes("DELEGATION_DONE"),
						),
					{ timeout: 30000 },
				)
				.toBe(true);
			const events = (await running.events.query({ limit: 1000 })).events;
			const external = events.filter((e) => e.type === "message.in" && (e.data as { kind?: string }).kind === "dm");
			expect(external).toHaveLength(1);
			const completions = events.filter(
				(e) => e.type === "runtime.tool-result" && (e.data as { tool?: string }).tool === "agent_ask",
			);
			expect(completions).toHaveLength(2);
			expect(new Set(completions.map((e) => e.id)).size).toBe(2);
			const source = external[0];
			if (!source) throw new Error("Missing original channel input");
			const msgId = (source.data as { msgId: string }).msgId;
			expect(completions.every((e) => (e.data as { msgId: string }).msgId === msgId)).toBe(true);
			const db = await openDatabase(`${home}/.yonder/state.db`, true);
			try {
				const rows = await db.all<{ record: string }>(
					"SELECT record FROM pi_entries WHERE conversation_id = ? ORDER BY id",
					Number(completions[0] && (completions[0].data as { session: string }).session),
				);
				const entries = rows.map((r) => JSON.parse(r.record));
				for (let i = 1; i <= 2; i++) {
					const token = await readFile(`${home}/child-${i}.txt`, "utf8");
					expect(await readFile(`${home}/parent-${i}.txt`, "utf8")).toContain(`RESULT_${i}=${token}`);
					const prepared = entries.find(
						(e) => e.kind === "yonder.prepared" && e.data?.event === completions[i - 1]?.id,
					);
					expect(prepared, `Missing prepared context for completion ${i}`).toBeTruthy();
					expect(JSON.stringify(prepared.edits)).toContain(token);
					const completed = completions[i - 1];
					expect(
						events.some((e) => e.type === "run.end" && (e.data as { inputs: string[] }).inputs.includes(completed!.id)),
					).toBe(true);
				}
				await writeFile(
					`${home}/evidence.json`,
					JSON.stringify(
						{
							events,
							prepared: entries.filter((e) => e.kind === "yonder.prepared"),
							deliveries: await readFile(`${home}/deliveries.jsonl`, "utf8"),
						},
						null,
						2,
					),
				);
			} finally {
				await db.close();
			}
			console.log(`Delegation evidence: ${home}/evidence.json`);
		} finally {
			await kernel?.close();
		}
	},
	300000,
);
