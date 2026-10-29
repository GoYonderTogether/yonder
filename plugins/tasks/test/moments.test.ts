import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginAPI, Tool, ToolContext, Trigger } from "@yonder/sdk";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { type Config, stallWindow, tick } from "../src/moments.js";
import { STALL_NOTICE } from "../src/prompts.js";
import { Store } from "../src/store/index.js";

const content = {
	title: "Inspect required input",
	objective:
		"Read required-input.txt in the workspace. If it is absent, mark this task blocked and name the missing file.",
	acceptance: ["Read the required file or record its absence", "Record the next step with the task tool"],
	nonGoals: ["Creating the missing input"],
};
const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");

async function fixture(config: Config = {}, real = false) {
	const home = await mkdtemp(join(tmpdir(), "yonder-task-moments-"));
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
			...(real ? { credentials: auth } : {}),
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
					model: "openai/gpt-6-luna",
					capabilities: ["read", "write", "network"],
					plugins: ["tasks"],
					contexts: ["tasks-turn"],
					tools: { offer: ["tasks_*", "read"], search: [] },
				},
			},
			bindings: [{ id: "seed", match: { type: "tasks.seed" }, session: "main", wake: "write" }],
		}),
	);
	// 账本只追加；这里同时留下内核日志，提醒失败的可读警告要能被验证。
	const logs: Array<[string, string]> = [];
	const log = (level: string, message: string) => logs.push([level, message]);
	let kernel = await openKernel(home, { log });
	const probe = (await import(pathToFileURL(join(home, "probe.mjs")).href)) as {
		api: PluginAPI;
		tools: Tool[];
		requests: Array<{ messages: unknown[]; ctx: ToolContext }>;
		sent: Array<{ text: string }>;
		triggers: Trigger[];
	};
	const seed = await probe.api.events.emit({ type: "tasks.seed", data: {} });
	const session = seed.routes![0]!.session!;
	const ctx: ToolContext = {
		agent: "main",
		session,
		profile: "owner",
		capabilities: ["read", "write", "cross-agent"],
		env: {} as never,
		signal: new AbortController().signal,
	};
	const store = new Store(probe.api.paths.data);
	const call = (name: string, args: object, caller = ctx) =>
		probe.tools.find((tool) => tool.name === `tasks_${name}`)!.execute(args, caller);
	return {
		home,
		probe,
		ctx,
		store,
		call,
		logs,
		kernel: () => kernel,
		async restart() {
			await kernel.close();
			kernel = await openKernel(home, { log });
		},
		async close() {
			await kernel.close();
			store.close();
			await rm(home, { recursive: true, force: true });
		},
	};
}

test("stall uses ledger windows, skips other states and survives a kernel restart", async () => {
	const f = await fixture();
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		for (const state of ["open", "waiting-user", "blocked", "review", "cancelled", "done"] as const) {
			const other = f.store.open(content, f.ctx);
			if (state === "open") continue;
			f.store.update(other.id, { state: "active" }, f.ctx);
			if (state === "done") {
				f.store.update(other.id, { state: "review" }, f.ctx);
				f.store.done(other.id, "Delivered", ["one", "two"], f.ctx);
			} else if (state === "blocked") {
				// 阻塞要同一说法连续报三轮。
				f.store.update(other.id, { note: "Missing input" }, f.ctx);
				f.store.update(other.id, { note: "Missing input" }, f.ctx);
				f.store.update(other.id, { state, note: "Missing input" }, f.ctx);
			} else f.store.update(other.id, { state }, f.ctx);
		}
		const now = Date.now() + 31 * 60000;
		await tick(f.probe.api, f.store, {}, now);
		await expect.poll(() => f.probe.requests.length).toBe(1);
		const inputs = () => f.kernel().events.query({ type: "session.input", from: "plugin:tasks" });
		expect((await inputs()).events).toHaveLength(1);
		expect((await inputs()).events[0]?.data).toMatchObject({
			session: f.ctx.session,
			busy: "followup",
			text: STALL_NOTICE(task.title, "active", 31),
		});
		// 默认窗口 20 分钟，允许 15–30。
		expect([stallWindow(), stallWindow(5), stallWindow(90)]).toEqual([20, 15, 30]);
		// 只给主 Agent 写事件：不向主人发消息，也不经过任何渠道。
		expect(f.probe.sent).toHaveLength(0);
		expect((await f.kernel().events.query({ type: "message.out" })).events).toHaveLength(0);
		await tick(f.probe.api, f.store, {}, now + 19 * 60000);
		expect((await inputs()).events).toHaveLength(1);
		// 到点才再催一次。
		await tick(f.probe.api, f.store, {}, now + 21 * 60000);
		expect((await inputs()).events).toHaveLength(2);
		// 取消之后即使窗口到了也不再催：二次校验要求任务仍 active。
		f.store.update(task.id, { state: "cancelled" }, f.ctx);
		await tick(f.probe.api, f.store, {}, now + 60 * 60000);
		expect((await inputs()).events).toHaveLength(2);
		// Keep a second active task to verify persisted window claims across a real restart.
		const active = f.store.open(content, f.ctx);
		f.store.update(active.id, { state: "active" }, f.ctx);
		await tick(f.probe.api, f.store, {}, now);
		const before = (await inputs()).events.length;
		await f.restart();
		const reopened = new Store(f.probe.api.paths.data);
		await tick(f.probe.api, reopened, {}, now + 19 * 60000);
		reopened.close();
		expect((await inputs()).events).toHaveLength(before);
		await tick(f.probe.api, f.store, {}, now + 21 * 60000);
		expect((await inputs()).events).toHaveLength(before + 1);
	} finally {
		await f.close();
	}
}, 30000);

test("user-wait submits one self-check per waiting state without sending reminders", async () => {
	const f = await fixture();
	try {
		const task = f.store.open({ ...content, origin: "conv:reminder:person" }, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "waiting-user", note: "请提供 required-input.txt" }, f.ctx);
		const second = f.store.open({ ...content, title: "Another task", origin: "conv:reminder:person" }, f.ctx);
		f.store.update(second.id, { state: "active" }, f.ctx);
		f.store.update(second.id, { state: "waiting-user", note: "需要回复" }, f.ctx);
		const noOrigin = f.store.open(content, f.ctx);
		f.store.update(noOrigin.id, { state: "active" }, f.ctx);
		f.store.update(noOrigin.id, { state: "waiting-user" }, f.ctx);
		const now = Date.now() + 121 * 60000;
		await tick(f.probe.api, f.store, {}, now);
		const late = f.store.open({ ...content, title: "Late task", origin: "conv:reminder:person" }, f.ctx);
		f.store.update(late.id, { state: "active" }, f.ctx);
		f.store.update(late.id, { state: "waiting-user", note: "稍后补充" }, f.ctx);
		const reopened = new Store(f.probe.api.paths.data);
		await tick(f.probe.api, reopened, {}, now + 119 * 60000);
		reopened.close();
		expect(f.probe.sent).toHaveLength(0);
		expect((await f.kernel().events.query({ type: "message.out" })).events).toHaveLength(0);
		const inputs = await f.kernel().events.query({ type: "session.input", from: "plugin:tasks" });
		expect(inputs.events).toHaveLength(3);
		expect(String(inputs.events[0]?.data.text)).toContain("自检任务");
		expect(String(inputs.events[0]?.data.text)).not.toContain("required-input.txt");
		expect(f.store.get(task.id, f.ctx).history.at(-1)?.data).toMatchObject({ moment: "user-wait" });
		await tick(f.probe.api, f.store, {}, now + 24 * 60 * 60000);
		expect(f.probe.sent).toHaveLength(0);
		expect((await f.kernel().events.query({ type: "session.input", from: "plugin:tasks" })).events).toHaveLength(3);
	} finally {
		await f.close();
	}
});

test("a failed reminder is recorded once and not repeated until the task progresses", async () => {
	const f = await fixture();
	try {
		// 任务会话已经不在：提醒发不出去，origin 也只是记录来源，不会被当成投递目标。
		const orphan = { ...f.ctx, session: "missing-session" };
		const task = f.store.open({ ...content, title: "Orphan", origin: "conv:reminder:person" }, orphan);
		f.store.update(task.id, { state: "active" }, orphan);
		f.store.update(task.id, { state: "waiting-user", note: "请提供 required-input.txt" }, orphan);
		const history = (id = task.id) => f.store.get(id, orphan).history;
		const warnings = () => f.logs.filter(([, msg]) => msg.startsWith("Task reminder failed"));
		const window = Date.now() + 121 * 60000;
		await tick(f.probe.api, f.store, {}, window);
		expect(f.probe.requests).toHaveLength(0);
		expect(history().at(-1)).toMatchObject({
			kind: "moment-result",
			data: { moment: "user-wait", error: expect.stringContaining("session") },
		});
		expect(warnings()).toHaveLength(1);
		// 同一批连续失败只记 1 次：再过几个窗口也不再发、不再记。
		await tick(f.probe.api, f.store, {}, window + 121 * 60000);
		await tick(f.probe.api, f.store, {}, window + 400 * 60000);
		expect(history().filter((event) => event.kind === "moment")).toHaveLength(1);
		expect(history().filter((event) => event.kind === "moment-result")).toHaveLength(1);
		expect(warnings()).toHaveLength(1);
		// 失败之后有了新进展，就允许再提醒一次。
		const resumed = f.store.open({ ...content, title: "Resumed", origin: "conv:reminder:person" }, orphan);
		f.store.update(resumed.id, { state: "active" }, orphan);
		f.store.update(resumed.id, { state: "waiting-user", note: "等待确认" }, orphan);
		f.store.momentResult(resumed.id, "user-wait", { error: "Not an open task session: missing-session" }, Date.now());
		f.store.update(resumed.id, { note: "已补充证据" }, orphan);
		await tick(f.probe.api, f.store, {}, window);
		// 新进展之后重新提醒一次（再次失败，所以 moment-result 变成两条）。
		expect(history(resumed.id).filter((event) => event.kind === "moment")).toHaveLength(1);
		expect(history(resumed.id).filter((event) => event.kind === "moment-result")).toHaveLength(2);
	} finally {
		await f.close();
	}
});

test("postCompact is off by default, records the real command error once when enabled; postRetain marks recently done", async () => {
	const f = await fixture({ moments: { postRetain: true } });
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "review" }, f.ctx);
		f.store.done(task.id, "Delivered", ["one", "two"], f.ctx);
		const now = Date.now();
		expect(JSON.parse((await f.call("list", {})).text)[0].recentlyDone).toBe(true);
		expect(f.store.recentlyDone(f.store.get(task.id, f.ctx).task, now + 30 * 60000)).toBe(false);
		await tick(f.probe.api, f.store, {}, now + 16 * 60000);
		expect(f.store.get(task.id, f.ctx).history.filter((event) => event.kind === "moment")).toHaveLength(0);
		const config = { moments: { postCompact: true } };
		await tick(f.probe.api, f.store, config, now + 16 * 60000);
		const reopened = new Store(f.probe.api.paths.data);
		await tick(f.probe.api, reopened, config, now + 32 * 60000);
		reopened.close();
		const history = f.store.get(task.id, f.ctx).history;
		expect(history.filter((event) => event.kind === "moment")).toHaveLength(1);
		expect(history.at(-1)).toMatchObject({
			kind: "moment-result",
			data: { moment: "postCompact", error: "修改模型或压缩需要 admin 权限" },
		});
	} finally {
		await f.close();
	}
});

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real openai/gpt-6-luna handles a stall notice with task tools or continues work",
	async () => {
		const f = await fixture({}, true);
		try {
			const task = f.store.open(content, f.ctx);
			f.store.update(task.id, { state: "active" }, f.ctx);
			await tick(f.probe.api, f.store, {}, Date.now() + 31 * 60000);
			await expect
				.poll(async () => (await f.kernel().events.query({ type: "run.end" })).events.length, { timeout: 90000 })
				.toBeGreaterThan(0);
			const current = f.store.get(task.id, f.ctx);
			const transcript = await f.kernel().sessions.transcript(f.ctx.session);
			const tools = transcript.flatMap((entry) => entry.tools ?? []).map((tool) => tool.name);
			console.log(
				"Real stall result:",
				JSON.stringify({
					state: current.task.state,
					tools,
					ends: (await f.kernel().events.query({ type: "run.end" })).events,
				}),
			);
			expect(["blocked", "waiting-user"].includes(current.task.state) || tools.includes("read")).toBe(true);
			expect(tools.some((name) => name === "tasks_update" || name === "read")).toBe(true);
		} finally {
			await f.close();
		}
	},
	120000,
);

test("task string schema accepts full text while rejecting blank values", async () => {
	const f = await fixture();
	try {
		const tool = f.probe.tools.find((item) => item.name === "tasks_get");
		const schema = tool?.parameters as { properties: { id: { pattern: string } } };
		const pattern = new RegExp(schema.properties.id.pattern, "u");
		expect(pattern.test("9eb7dd39-bca3-4f8a-bbe7-6e9a562cf44c")).toBe(true);
		expect(pattern.test("\n中文\n")).toBe(true);
		expect(pattern.test(" \n\t")).toBe(false);
	} finally {
		await f.close();
	}
});
