import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hook, Message, PluginAPI, RenderContext, Tool, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import tasks from "../src/index.js";
import { Store } from "../src/store/index.js";
import { auditPrompt, parseAuditVerdict } from "../src/views.js";

const content = {
	title: "Audited ledger",
	objective: "Close only after an independent audit",
	acceptance: ["Ledger restored", "Board rendered"],
	nonGoals: [],
};

type Reply = { status?: string; text?: string; reason?: string } | Error;

/** 假 sessions API：审计接线用假会话，模型回复由用例直接给定，不冒充真实模型。 */
async function fixture(reply: Reply | ((index: number) => Reply), config: object = {}) {
	const data = await mkdtemp(join(tmpdir(), "yonder-tasks-audit-"));
	const tools: Tool[] = [];
	const hooks: Hook[] = [];
	const opened: string[] = [];
	const closed: string[] = [];
	const prompts: string[] = [];
	const api = {
		paths: { data },
		config,
		locale: "en",
		invalidate() {},
		log: { warn() {}, info() {}, error() {}, debug() {} },
		sessions: {
			async open(request: { preset: string }) {
				opened.push(request.preset);
				return { id: `audit-${opened.length}` };
			},
			async submit(id: string, input: { text: string }) {
				prompts.push(input.text);
				const next = typeof reply === "function" ? reply(prompts.length) : reply;
				if (next instanceof Error) throw next;
				return {
					agent: "auditor",
					session: id,
					status: next.status ?? "done",
					text: next.text ?? "",
					...(next.reason ? { reason: next.reason } : {}),
				};
			},
			async close(id: string) {
				closed.push(id);
			},
		},
		tools: {
			register(tool: Tool) {
				tools.push(tool);
			},
		},
		hooks: {
			register(hook: Hook) {
				hooks.push(hook);
			},
		},
		views: { register() {} },
		contexts: { register() {} },
		triggers: { register() {} },
		messages: { send: async () => ({ ok: true }) },
	};
	tasks.setup(api as unknown as PluginAPI);
	const store = new Store(data);
	const ctx: ToolContext = {
		agent: "main",
		session: "1",
		profile: "owner",
		capabilities: ["read", "write"],
		env: {} as never,
		signal: new AbortController().signal,
	};
	const context: RenderContext = {
		agent: "main",
		session: "1",
		profile: "owner",
		workspace: { read: async () => undefined },
	};
	const call = (name: string, args: object) => tools.find((tool) => tool.name === `tasks_${name}`)!.execute(args, ctx);
	return {
		data,
		store,
		ctx,
		context,
		call,
		hooks,
		opened,
		closed,
		prompts,
		tool: (name: string) => tools.find((tool) => tool.name === `tasks_${name}`)!,
		async close() {
			store.close();
			await rm(data, { recursive: true, force: true });
		},
	};
}

const message = (input: number, output: number): Message =>
	({ role: "assistant", content: [], usage: { input, output } }) as unknown as Message;

test("only the last non-empty line decides, and anything else counts as rejection", () => {
	expect(parseAuditVerdict("checks pass\n<approved/>")).toEqual({ verdict: "approved", reason: "checks pass" });
	expect(parseAuditVerdict("Acceptance 2 has no evidence\n<disapproved/>")).toEqual({
		verdict: "rejected",
		reason: "Acceptance 2 has no evidence",
	});
	// 没有末行标记就当驳回：宁可任务留着，也不凭一句自述关闭。
	expect(parseAuditVerdict("looks fine to me")).toEqual({ verdict: "rejected", reason: "looks fine to me" });
	const prompt = auditPrompt({ ...content, id: "t1", ref: "T1", state: "review", budget: {} } as never, "Ledger done", [
		"evidence one",
		"evidence two",
	]);
	expect(prompt).toContain("read-only completion auditor");
	expect(prompt).toContain("Never approve unless the actual user objective is complete.");
	expect(prompt).toContain("evidence two");
	expect(prompt.trimEnd().endsWith("<disapproved/>")).toBe(true);
});

test("a rejected audit keeps the task open and the rejection reaches the turn block", async () => {
	const f = await fixture({ text: "Acceptance 2 has no evidence\n<disapproved/>" });
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "review" }, f.ctx);
		const result = await f.call("done", { id: task.id, deliverable: "Ledger done", evidence: ["one", "two"] });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("An independent auditor rejected this completion: Acceptance 2 has no evidence");
		const after = f.store.get(task.id, f.ctx);
		expect(after.task.state).toBe("review");
		expect(after.task.auditResult).toMatchObject({ verdict: "rejected", preset: "default", session: "audit-1" });
		expect(after.history.filter((event) => event.kind === "audit")).toHaveLength(1);
		expect(f.prompts[0]).toContain(content.objective);
		expect(f.opened).toEqual(["default"]);
		expect(f.closed).toEqual(["audit-1"]);
		expect(f.store.render(f.context)).toContain("[AUDITOR REJECTION]");
	} finally {
		await f.close();
	}
});

test("an approved audit closes the task", async () => {
	const f = await fixture({ text: "every point is covered\n<approved/>" });
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "review" }, f.ctx);
		const result = await f.call("done", { id: task.id, deliverable: "Ledger done", evidence: ["one", "two"] });
		expect(result.isError).not.toBe(true);
		const after = f.store.get(task.id, f.ctx);
		expect(after.task.state).toBe("done");
		expect(after.task.auditResult).toMatchObject({ verdict: "approved" });
		// 关闭的任务不再进任务块，驳回意见自然也不出现。
		expect(f.store.render(f.context)).toBeUndefined();
	} finally {
		await f.close();
	}
});

test("an auditor run that does not finish counts as a rejection", async () => {
	const f = await fixture({ status: "error", reason: "provider unavailable" });
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		f.store.update(task.id, { state: "review" }, f.ctx);
		const result = await f.call("done", { id: task.id, deliverable: "Ledger done", evidence: ["one", "two"] });
		expect(result.isError).toBe(true);
		expect(result.text).toContain("ended as error: provider unavailable");
		expect(f.store.get(task.id, f.ctx).task.state).toBe("review");
	} finally {
		await f.close();
	}
});

test("the token budget settles once and injects one wrap-up", async () => {
	const f = await fixture({}, {});
	try {
		const task = f.store.open({ ...content, budget: { tokens: 100 } }, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		const hook = f.hooks.find((item) => item.id === "tasks-budget")!;
		const run = (messages: Message[]) =>
			hook.beforeRequest!(messages, f.ctx) as Promise<{ messages: Message[] } | undefined> | undefined;
		expect(await run([message(60, 20)])).toBeUndefined();
		expect(f.store.get(task.id, f.ctx).task.budget.used).toBe(80);
		const reached = await run([message(90, 20)]);
		expect(JSON.stringify(reached?.messages.at(-1))).toContain("[TOKEN BUDGET REACHED task=T1 used=110 cap=100]");
		expect((await run([message(90, 20)])) === undefined).toBe(true);
		expect(f.store.get(task.id, f.ctx).task.state).toBe("active");
	} finally {
		await f.close();
	}
});

test("the turn block comes from the ledger on every request, so compaction cannot drop it", async () => {
	const f = await fixture({});
	try {
		const task = f.store.open(content, f.ctx);
		f.store.update(task.id, { state: "active" }, f.ctx);
		// 第一次渲染给完整目标；之后每轮仍从账本渲染一行状态，与转录是否被压缩无关。
		expect(f.store.render(f.context)).toContain(content.objective);
		const compacted = f.store.render({ ...f.context, session: "1" })!;
		expect(compacted).toContain(task.ref);
		expect(compacted).toContain(content.title);
		// 账本一变（普通更新），完整目标立刻在新的一轮里重新出现。
		f.store.update(task.id, { objective: "Revised after compaction" }, f.ctx);
		expect(f.store.render({ ...f.context, session: "1" })).toContain("Revised after compaction");
	} finally {
		await f.close();
	}
});
