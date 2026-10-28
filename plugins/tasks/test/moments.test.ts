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
import { NUDGE_INPUT, STALL_NOTICE, USER_WAIT_NOTICE } from "../src/prompts.js";
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
	let kernel = await openKernel(home, { log() {} });
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

test("stall uses ledger windows, skips other states and survives a kernel restart; nudge reaches the owner", async () => {
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
		await tick(f.probe.api, f.store, {}, now + 29 * 60000);
		expect((await inputs()).events).toHaveLength(1);
		const nudged = await f.call(
			"nudge",
			{ id: task.id, say: "Report the missing input" },
			{ ...f.ctx, agent: "steward" },
		);
		expect(nudged.isError).not.toBe(true);
		const nudge = (await inputs()).events.at(-1)!;
		expect(nudge.data).toMatchObject({
			session: f.ctx.session,
			text: NUDGE_INPUT(task.title, "steward", "Report the missing input"),
			busy: "followup",
		});
		await expect
			.poll(async () => (await f.kernel().terminal.queued(f.ctx.session)).map((entry) => entry.event))
			.toContain(nudge.id);
		f.store.update(task.id, { state: "cancelled" }, f.ctx);
		expect((await f.call("nudge", { id: task.id, say: "closed" })).isError).toBe(true);
		expect((await f.call("nudge", { id: "missing", say: "missing" })).isError).toBe(true);
		expect(f.probe.tools.find((tool) => tool.name === "tasks_nudge")?.capabilities).toEqual(["cross-agent"]);
		// Keep a second active task to verify persisted window claims across a real restart.
		const active = f.store.open(content, f.ctx);
		f.store.update(active.id, { state: "active" }, f.ctx);
		await tick(f.probe.api, f.store, {}, now);
		const before = (await inputs()).events.length;
		await f.restart();
		await tick(f.probe.api, new Store(f.probe.api.paths.data), {}, now + 29 * 60000);
		expect((await inputs()).events).toHaveLength(before);
		await tick(f.probe.api, f.store, {}, now + 30 * 60000);
		expect((await inputs()).events).toHaveLength(before + 1);
	} finally {
		await f.close();
	}
}, 30000);

test("user-wait delivers one localized program message per window without waking a model or sending without origin", async () => {
	const f = await fixture();
	try {
		const task = f.store.open({ ...content, origin: "conv:reminder:person" }, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "waiting-user", note: "请提供 required-input.txt" }, f.ctx);
		const noOrigin = f.store.open({ ...content, origin: "" }, f.ctx);
		f.store.update(noOrigin.id, { state: "active" }, f.ctx);
		f.store.update(noOrigin.id, { state: "waiting-user" }, f.ctx);
		const now = Date.now() + 121 * 60000;
		await tick(f.probe.api, f.store, {}, now);
		await tick(f.probe.api, new Store(f.probe.api.paths.data), {}, now + 119 * 60000);
		expect(f.probe.sent.map((message) => message.text)).toEqual([
			USER_WAIT_NOTICE(true, task.title, 121, "请提供 required-input.txt"),
		]);
		expect(f.probe.requests).toHaveLength(0);
		expect((await f.kernel().events.query({ type: "session.input" })).events).toHaveLength(0);
		expect((await f.kernel().events.query({ type: "message.out" })).events).toHaveLength(1);
		await tick(f.probe.api, f.store, {}, now + 120 * 60000);
		expect(f.probe.sent).toHaveLength(2);
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
		await tick(f.probe.api, new Store(f.probe.api.paths.data), config, now + 32 * 60000);
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
