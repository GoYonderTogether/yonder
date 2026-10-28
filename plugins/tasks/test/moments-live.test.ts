import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginAPI, Tool, ToolContext, Trigger } from "@yonder/sdk";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { type Config, tick } from "../src/moments.js";
import { Store } from "../src/store/index.js";

const auth = process.env.YONDER_TASKS_AUTH_SOURCE;

async function fixture(config: Config = {}, real = true) {
	const home = await mkdtemp(join(tmpdir(), "yonder-task-moments-"));
	if (!auth) throw new Error("missing auth source");
	const source = JSON.parse(await readFile(auth, "utf8"));
	if (source.siliconflow?.type !== "api_key" || typeof source.siliconflow.key !== "string")
		throw new Error("siliconflow slot unavailable");
	const isolatedAuth = join(home, "auth.json");
	await writeFile(isolatedAuth, JSON.stringify({ siliconflow: source.siliconflow }), { mode: 0o600 });
	const manifest = JSON.parse(await readFile(resolve("plugins/tasks/package.json"), "utf8"));
	manifest.yonder.entry = "./probe.mjs";
	manifest.yonder.contributes.hooks.push("hold");
	manifest.yonder.contributes.channels = ["task-test"];
	await writeFile(join(home, "package.json"), JSON.stringify(manifest));
	// Capture actual registrations and local channel delivery; hold/cancel real requests
	// before a provider call in protocol tests. The opt-in test uses the real provider.
	await writeFile(
		join(home, "probe.mjs"),
		`import tasks from ${JSON.stringify(pathToFileURL(resolve("plugins/tasks/dist/index.js")).href)};
export let api;
export const tools = [], requests = [], sent = [], triggers = [];
export default { configSchema: tasks.configSchema, setup(value) {
  api = value;
  tasks.setup({...api,
    tools: {register(tool) {tools.push(tool); api.tools.register(tool);}},
    triggers: {register(trigger) {triggers.push(trigger); api.triggers.register(trigger);}}
  });
  api.hooks.register({id:'hold', async beforeRequest(messages, ctx) {
    requests.push({messages, ctx});
    if (${real}) return;
    await new Promise(resolve => ctx.signal.aborted ? resolve() : ctx.signal.addEventListener('abort', resolve, {once:true}));
  }});
  api.channels.register({type:'task-test', create(id) {return {
    id, kinds:['dm'], output:{stream:false, attachments:false}, async start() {}, async stop() {},
    async send(target, message) {sent.push(message); return {ok:true};}
  };}});
}};`,
	);
	await mkdir(join(home, "agents/main"), { recursive: true });
	await writeFile(
		join(home, "yonder.yaml"),
		stringify({
			schema: 1,
			locale: "zh-CN",
			plugins: [{ use: home, config }],
			agents: [{ id: "main", workspace: "./agents/main" }],
			channels: { reminder: { type: "task-test" } },
			...(real
				? {
						credentials: isolatedAuth,
						models: {
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
						},
					}
				: {}),
		}),
	);
	await writeFile(
		join(home, "agents/main/agent.yaml"),
		stringify({
			schema: 1,
			id: "main",
			name: "Task moments protocol test",
			owner: "person:test",
			defaultProfile: "owner",
			profiles: {
				owner: {
					model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
					capabilities: ["read", "write", "network"],
					plugins: ["tasks"],
					contexts: ["tasks-turn"],
					tools: { offer: ["tasks_*", "read", "write"], search: [] },
				},
			},
			bindings: [{ id: "seed", match: { type: "tasks.seed" }, session: "main", wake: "write" }],
		}),
	);
	let kernel = await openKernel(home, { log() {} });
	const probe = (await import(pathToFileURL(join(home, "probe.mjs")).href)) as {
		api: PluginAPI;
		tools: Tool[];
		requests: Array<{ messages: unknown[]; ctx: ToolContext }>;
		sent: Array<{ text: string }>;
		triggers: Trigger[];
	};
	const seed = await probe.api.events.emit({ type: "tasks.seed", data: {} });
	const session = seed.routes?.[0]?.session;
	if (!session) throw new Error("seed session unavailable");
	const ctx: ToolContext = {
		agent: "main",
		session,
		profile: "owner",
		capabilities: ["read", "write", "cross-agent"],
		env: {} as never,
		signal: new AbortController().signal,
	};
	const store = new Store(probe.api.paths.data);

	return {
		home,
		probe,
		ctx,
		store,
		kernel: () => kernel,
		async restart() {
			await kernel.close();
			kernel = await openKernel(home, { log() {} });
		},
		async close() {
			await kernel.close();
			store.close();
			await rm(home, { recursive: true, force: true });
		},
	};
}

test.skipIf(!auth || !existsSync(auth))(
	"real SiliconFlow checks four waiting tasks before any reminder",
	async () => {
		const cases = [
			{
				title: "完成检查",
				objective: "核对 workspace 中 result.txt 已包含 DONE，确认两项验收并完成任务。",
				acceptance: ["result.txt 存在", "result.txt 内容为 DONE"],
				expected: "done",
			},
			{
				title: "过期检查",
				objective: "此任务截止 2000-01-01，已经过期；请取消任务并记录原因。",
				acceptance: ["核对截止日期", "记录过期原因"],
				expected: "cancelled",
			},
			{
				title: "自主处理检查",
				objective: "读取 workspace 中 result.txt 并记录其内容，你可以自己完成，不需要主人参与。",
				acceptance: ["读取 result.txt", "记录内容"],
				expected: "self",
			},
			{
				title: "决定检查",
				objective: "主人尚未选择最终交付语言，必须由主人决定选择中文还是英文，不能自行猜测。",
				acceptance: ["确定交付语言", "记录主人选择"],
				expected: "waiting-user",
			},
		];
		const results = await Promise.allSettled(
			cases.map(async (item) => {
				const f = await fixture();
				try {
					await writeFile(join(f.home, "agents/main/result.txt"), "DONE\n");
					const task = f.store.open(
						{
							title: item.title,
							objective: item.objective,
							acceptance: item.acceptance,
							nonGoals: [],
							origin: "conv:reminder:person",
						},
						f.ctx,
					);
					f.store.update(task.id, { state: "active" }, f.ctx);
					f.store.update(task.id, { state: "waiting-user", note: item.objective }, f.ctx);
					await tick(f.probe.api, f.store, {}, Date.now() + 121 * 60000);
					await expect
						.poll(async () => (await f.kernel().events.query({ type: "run.end" })).events.length, { timeout: 180000 })
						.toBeGreaterThan(0);
					const current = f.store.get(task.id, f.ctx);
					const transcript = await f.kernel().sessions.transcript(f.ctx.session);
					const ends = (await f.kernel().events.query({ type: "run.end" })).events;
					const inputs = (await f.kernel().events.query({ type: "session.input", from: "plugin:tasks" })).events;
					console.log(
						JSON.stringify({
							case: item.expected,
							transcript: transcript.map(({ kind, text, tools }) => ({ kind, text, tools })),
							state: current.task.state,
							runEnds: ends.length,
							runStatus: (ends.at(-1)?.data as { status?: string } | undefined)?.status,
							selfChecks: inputs.length,
							sent: f.probe.sent.length,
						}),
					);
					expect((ends.at(-1)?.data as { status?: string } | undefined)?.status).toBe("done");
					expect(inputs).toHaveLength(1);
					expect(f.probe.sent).toHaveLength(0);
					if (item.expected === "self") expect(["active", "review", "done"]).toContain(current.task.state);
					else expect(current.task.state).toBe(item.expected);
				} finally {
					await f.close();
				}
			}),
		);
		expect(results.filter((result) => result.status === "rejected")).toEqual([]);
	},
	230000,
);
