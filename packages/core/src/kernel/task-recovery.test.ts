import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { FileCredentials } from "../runtime/credentials.js";
import { openDatabase } from "../runtime/db.js";
import { buildModels } from "../runtime/models.js";
import { initHome } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth);
for (const tool of ["agent_ask", "task_run"] as const) {
	test.skipIf(!real)(
		`real Luna ${tool}: child wait survives process restart, continuation and delivery recover without a new user input`,
		async () => {
			const home = await mkdtemp(`/tmp/yonder-task-recovery-${tool}-`);
			const upstream = buildModels(new FileCredentials(auth)).getModel("openai", "gpt-6-luna")!.baseUrl;
			let offline = true,
				blocked = 0;
			const statuses: number[] = [];
			const server = createServer(async (req, res) => {
				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(Buffer.from(chunk));
				const body = Buffer.concat(chunks);
				const child = /agent ID is helper;|current profile is helper\./.test(body.toString());
				if (child && offline && existsSync(`${home}/effect`)) {
					blocked++;
					res.writeHead(503, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: { message: "Network unavailable during child completion" } }));
					return;
				}
				try {
					const headers = new Headers();
					for (const [key, value] of Object.entries(req.headers))
						if (value && !["host", "connection", "content-length"].includes(key)) headers.set(key, String(value));
					const response = await fetch(`${upstream.replace(/\/$/, "")}${req.url!.replace(/^\/v1/, "")}`, {
						method: "POST",
						headers,
						body,
					});
					statuses.push(response.status);
					res.writeHead(response.status, {
						"content-type": response.headers.get("content-type") ?? "text/event-stream",
					});
					if (response.body) Readable.fromWeb(response.body).pipe(res);
					else res.end();
				} catch {
					res.destroy();
				}
			});
			await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
			let childProcess: ChildProcess | undefined;
			let diagnostics = "";
			const launch = async () => {
				await rm(`${home}/ready`, { force: true });
				childProcess = spawn(
					process.execPath,
					[
						"--input-type=module",
						"-e",
						`import {openKernel} from ${JSON.stringify(pathToFileURL(resolve("packages/core/dist/kernel/index.js")).href)}; const kernel=await openKernel(${JSON.stringify(home)}); process.on('SIGTERM',()=>{void kernel.close().then(()=>process.exit(0))}); setInterval(()=>{},1000);`,
					],
					{ stdio: ["ignore", "ignore", "pipe"] },
				);
				childProcess.stderr?.on("data", (chunk) => {
					diagnostics += String(chunk).slice(-2000);
				});
				await expect
					.poll(
						() => {
							if (childProcess?.exitCode !== null) throw new Error(diagnostics);
							return existsSync(`${home}/ready`);
						},
						{ timeout: 30000 },
					)
					.toBe(true);
			};
			const stop = async (signal: NodeJS.Signals) => {
				if (!childProcess || childProcess.exitCode !== null) return;
				const ended = new Promise<void>((done) => childProcess!.once("exit", () => done()));
				childProcess.kill(signal);
				await ended;
				childProcess = undefined;
			};
			try {
				await initHome(home, "owner", { model: testModel });
				await mkdir(`${home}/source`);
				const command = `node -e 'const fs=require("node:fs");const value=require("node:crypto").randomUUID();fs.appendFileSync("${home}/effect",value+"\\n");process.stdout.write(value)'`;
				const task = `Call bash exactly once with command: ${command}. Return the actual token from stdout. Never repeat the command, including after connection failures or restart.`;
				const delegation = tool === "agent_ask" ? `agent_ask to agent helper` : `task_run with preset helper`;
				const prompt = `Call ${delegation} exactly once. Include only ${tool === "agent_ask" ? "agent and text" : "preset and task"} arguments; omit sources and effort. Set its ${tool === "agent_ask" ? "text" : "task"} argument to exactly this JSON string: ${JSON.stringify(task)}
Parent workflow: if the call returns a running background handle, reply exactly WAITING and rely on automatic completion. Do not poll or delegate again. Only after its completed result contains the actual token, call write with path set to exactly ${JSON.stringify(`${home}/parent`)} and content set to that token. This is an absolute path; do not modify it or prepend cwd. Then use task_continue with text: ${JSON.stringify(`Call write with path exactly "${home}/continued" and content "CONTINUED", then reply exactly RECOVERY_DONE`)}. End the current progress report with exactly CHILD_RECEIVED. Execute the queued step only when its separate runtime.continuation input arrives. Do not ask the user to continue.`;
				await writeFile(`${home}/source/input.json`, JSON.stringify({ text: prompt, msgId: `restart-${tool}` }));
				await writeFile(
					`${home}/source/package.json`,
					JSON.stringify({
						name: "task-recovery-ingress",
						version: "1.0.0",
						type: "module",
						yonder: {
							apiVersion: 1,
							id: "task-recovery-ingress",
							entry: "index.mjs",
							contributes: { channels: ["recovery-source"] },
						},
					}),
				);
				// Only ingress and channel transport are driven here; every model/tool/task runs in the built kernel.
				await writeFile(
					`${home}/source/index.mjs`,
					`import {readFile,appendFile,writeFile,access} from 'node:fs/promises';
export default {setup(api){api.channels.register({type:'recovery-source',create(id){return {id,kinds:['dm'],output:{stream:false,attachments:false},async start(io){await writeFile('${home}/ready','ready');const input=JSON.parse(await readFile('${home}/source/input.json','utf8'));await io.emit({type:'message.in',from:'acct:feishu:owner',conv:'conv:feishu:acceptance',data:{kind:'dm',...input}})},async stop(){},async send(to,message){if(message.text.trim()==='RECOVERY_DONE'){try{await access('${home}/delivery-online')}catch{await appendFile('${home}/attempts','offline\\n');return {ok:false,retryable:true,error:'ECONNREFUSED before dispatch'}}}await appendFile('${home}/deliveries.jsonl',JSON.stringify({to,text:message.text})+'\\n');return {ok:true,id:'accepted'}}}}})}};`,
				);
				const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
				config.credentials = auth;
				config.retry = { maxRetries: 100, baseDelayMs: 1000, maxDelayMs: 1000 };
				config.models = {
					providers: {
						openai: {
							baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
							modelOverrides: {
								"gpt-6-luna": {
									compat: {
										supportsMidConvoEffort: false,
										supportsMaxOutputTokens: false,
										supportsExplicitPromptCacheMode: false,
									},
								},
							},
						},
					},
				};
				config.plugins.push({ use: "./source" });
				config.channels = { feishu: { type: "recovery-source" } };
				config.identity.persons[0].accounts = ["acct:feishu:owner"];
				await writeFile(
					`${home}/presets/helper.yaml`,
					stringify({
						schema: 1,
						description: "Recovery acceptance task",
						model: "openai/gpt-6-luna",
						thinking: "low",
						level: "standard",
						tools: { offer: ["bash", "process"] },
					}),
				);
				config.agents.push({ id: "helper", workspace: "./agents/helper" });
				await writeFile(`${home}/yonder.yaml`, stringify(config));
				const parentPath = `${home}/agents/main/agent.yaml`;
				const parent = parse(await readFile(parentPath, "utf8"));
				parent.defaults.contexts = [];
				parent.profiles.owner.tools = { offer: [tool, "write", "task_continue"] };
				parent.bindings.find((binding: { id: string }) => binding.id === "owner")!.match.channel = "feishu";
				await writeFile(parentPath, stringify(parent));
				await mkdir(`${home}/agents/helper`);
				await writeFile(
					`${home}/agents/helper/agent.yaml`,
					stringify({
						schema: 1,
						id: "helper",
						name: "helper",
						owner: "person:owner",
						defaultProfile: "helper",
						profiles: {
							helper: {
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
								profile: "helper",
								reply: "none",
							},
						],
					}),
				);
				await launch();
				await expect.poll(() => blocked, { timeout: 90000 }).toBeGreaterThan(0);
				await expect
					.poll(
						async () =>
							existsSync(`${home}/deliveries.jsonl`) &&
							(await readFile(`${home}/deliveries.jsonl`, "utf8")).includes("WAITING"),
						{ timeout: 60000 },
					)
					.toBe(true);
				expect(existsSync(`${home}/parent`)).toBe(false);
				await stop("SIGKILL");
				// proper-lockfile's existing stale lock policy, without touching the dead process's lock.
				await sleep(11000);
				offline = false;
				await launch();
				await expect.poll(() => existsSync(`${home}/continued`), { timeout: 120000 }).toBe(true);
				await expect.poll(() => existsSync(`${home}/attempts`), { timeout: 30000 }).toBe(true);
				const effect = (await readFile(`${home}/effect`, "utf8")).trim().split("\n");
				expect(effect).toHaveLength(1);
				expect(await readFile(`${home}/parent`, "utf8")).toContain(effect[0]!);
				expect(await readFile(`${home}/continued`, "utf8")).toContain("CONTINUED");
				await stop("SIGTERM");
				await writeFile(`${home}/delivery-online`, "online");
				await launch();
				await expect
					.poll(
						async () =>
							(await readFile(`${home}/deliveries.jsonl`, "utf8"))
								.split("\n")
								.filter(Boolean)
								.some((line) => JSON.parse(line).text.trim() === "RECOVERY_DONE"),
						{
							timeout: 30000,
						},
					)
					.toBe(true);
				await stop("SIGTERM");
				const db = await openDatabase(`${home}/.yonder/state.db`, true);
				try {
					const events = await db.all<{ type: string; data: string }>("SELECT type,data FROM y_events ORDER BY id");
					expect(events.filter((e) => e.type === "message.in" && JSON.parse(e.data).kind === "dm")).toHaveLength(1);
					const submissions = await db.all<{ record: string }>("SELECT record FROM pi_submissions");
					expect(submissions.filter((e) => JSON.parse(e.record).requestId?.startsWith("continuation:"))).toHaveLength(
						1,
					);
					expect(submissions.filter((e) => ["placed", "queued"].includes(JSON.parse(e.record).status))).toHaveLength(0);
					const delegations = events.filter(
						(e) => e.type === "runtime.tool-result" && JSON.parse(e.data).tool === tool,
					);
					expect(delegations).toHaveLength(1);
					expect(JSON.parse(delegations[0]!.data).text).toContain(effect[0]!);
					const rows = await db.all<{ record: string }>(
						"SELECT record FROM pi_entries WHERE conversation_id = (SELECT MIN(id) FROM y_sessions)",
					);
					expect(
						rows.some((r) => {
							const e = JSON.parse(r.record);
							return e.kind === "yonder.prepared" && e.data.event && JSON.stringify(e.edits).includes(effect[0]!);
						}),
					).toBe(true);
					const delivered = (await readFile(`${home}/deliveries.jsonl`, "utf8"))
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line));
					expect(delivered.filter((e) => e.text.trim() === "RECOVERY_DONE")).toHaveLength(1);
					expect(
						statuses.every((s) => s === 200),
						JSON.stringify(statuses),
					).toBe(true);
					await writeFile(
						`${home}/evidence.json`,
						JSON.stringify({ tool, blocked, statuses, effects: effect.length, events, deliveries: delivered }, null, 2),
					);
				} finally {
					await db.close();
				}
				console.log(`Task recovery evidence: ${home}/evidence.json`);
			} finally {
				await stop("SIGTERM");
				server.closeAllConnections();
				await new Promise<void>((done) => server.close(() => done()));
				if (diagnostics) console.log(diagnostics.slice(-2000));
			}
		},
		300000,
	);
}
