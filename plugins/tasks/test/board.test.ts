import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { renderPng, renderSvg, renderText, taskBoard } from "../src/board.js";
import { digest } from "../src/digest.js";
import { Store } from "../src/store.js";
import { fixture } from "./board-fixture.js";

const content = {
	title: "Check ledger <&> 中文",
	objective: "Persist and display task evidence",
	acceptance: ["Ledger restored", "Board rendered"],
	nonGoals: [],
};

test("board order, short refs across restart, evidence, parent visibility and pure renderers", async () => {
	const f = await fixture();
	try {
		const open = f.store.open(content, f.ctx);
		const blocked = f.store.open(content, f.ctx);
		f.store.update(blocked.ref, { state: "active" }, f.ctx);
		f.store.update(blocked.ref, { state: "blocked" }, f.ctx);
		const waiting = f.store.open(content, f.ctx);
		f.store.update(waiting.ref, { state: "active" }, f.ctx);
		f.store.update(waiting.ref, { state: "review" }, f.ctx);
		const done = f.store.open(content, f.ctx);
		f.store.update(done.ref, { state: "active" }, f.ctx);
		f.store.update(done.ref, { state: "review" }, f.ctx);
		f.store.done(done.ref, "Delivered", ["SQLite rows", "PNG bytes"], f.ctx);
		const child = f.store.open({ ...content, parent: open.ref }, { ...f.ctx, agent: "child" });
		const foreign = f.store.open(content, { ...f.ctx, agent: "foreign" });
		const own = { ...f.ctx, capabilities: ["read"] };
		const board = taskBoard(f.store.list(own), Date.now());
		expect(board.groups.map((g) => g.id)).toEqual(["waiting", "inProgress", "blocked", "done"]);
		expect(board.counts).toEqual({ waiting: 1, inProgress: 2, blocked: 1 });
		expect(board.groups[3]!.items[0]!.acceptance).toEqual({ met: 2, total: 2 });
		expect(board.groups[1]!.items[0]!.children[0]!.id).toBe(child.id);
		expect(JSON.stringify(board)).not.toContain(foreign.id);
		expect(taskBoard(f.store.list(f.ctx), Date.now()).counts.inProgress).toBe(3);
		expect(taskBoard(f.store.list(own), Date.now() + 30 * 60000).groups[3]!.items).toEqual([]);
		expect(renderText(board, "zh-CN")).toContain("1 等你 · 2 进行中 · 1 阻塞");
		expect(renderText(board)).toContain("Waiting for you");
		const svg = renderSvg(board, "zh");
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain("Check ledger &lt;&amp;&gt; 中文");
		expect((await renderPng(board, "zh")).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		await f.restart();
		const reopened = new Store(f.probe.api.paths.data);
		expect(reopened.get(open.ref, own).task.id).toBe(open.id);
		expect(reopened.get(done.id, own).task.ref).toBe(done.ref);
		expect(reopened.open(content, own).ref).toBe("T7");
	} finally {
		await f.close();
	}
});

test("loaded tasks_show returns board/detail JSON and sends a real PNG through the local channel", async () => {
	const f = await fixture();
	try {
		const task = f.store.open(content, f.ctx);
		expect(JSON.parse((await f.call("show", { target: "json" })).text).counts.inProgress).toBe(1);
		const detail = JSON.parse((await f.call("show", { target: "json", view: "detail", id: task.ref })).text);
		expect(detail.detail.task.objective).toBe(content.objective);
		expect(detail.detail.history[0].kind).toBe("open");
		expect(detail.detail.children).toEqual([]);
		for (const target of ["desktop", "web"])
			expect(await f.call("show", { target })).toMatchObject({
				isError: true,
				text: expect.stringContaining("renderer.json"),
			});
		expect((await f.call("show", { target: "json", view: "detail" })).isError).toBe(true);
		const event = await f.probe.io.emit({
			type: "message.in",
			from: "acct:reminder:person",
			conv: "conv:reminder:person",
			data: { kind: "dm", text: "Show the board" },
		});
		const result = await f.call("show", {}, { ...f.ctx, event });
		expect(result.isError).not.toBe(true);
		expect(JSON.parse(result.text).ok).toBe(true);
		const attachment = f.probe.sent.at(-1)!.attachments![0]!;
		expect(attachment.mime).toBe("image/png");
		expect((await readFile(new URL(attachment.uri))).subarray(0, 8)).toEqual(
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
		expect(f.probe.sent.at(-1)!.text).toBe("");
	} finally {
		await f.close();
	}
});

test("digest is conditional, ordered, capped, destination-scoped and persisted; own and non-human messages stay untouched", async () => {
	const f = await fixture();
	try {
		const event = await f.probe.io.emit({
			type: "message.in",
			from: "acct:reminder:person",
			conv: "conv:reminder:person",
			data: { kind: "dm", text: "Status?" },
		});
		const hook = f.probe.hooks[0]!;
		const message = { to: event.conv!, text: "Reply" };
		expect(await hook.beforeSend!(message, f.ctx)).toBeUndefined();
		const task = f.store.open(content, f.ctx);
		f.store.update(task.ref, { state: "active" }, f.ctx);
		expect(await hook.beforeSend!(message, f.ctx)).toBeUndefined();
		f.store.update(task.ref, { state: "blocked" }, f.ctx);
		const waiting = f.store.open({ ...content, title: "Need the input" }, f.ctx);
		f.store.update(waiting.ref, { state: "active" }, f.ctx);
		f.store.update(waiting.ref, { state: "waiting-user" }, f.ctx);
		expect(await hook.beforeSend!({ ...message, text: "", attachments: [] }, f.ctx)).toBeUndefined();
		expect(await hook.beforeSend!({ ...message, to: "agent:other" }, f.ctx)).toBeUndefined();
		expect(await hook.beforeSend!(message)).toBeUndefined();
		await f.probe.api.messages.send(message);
		expect(f.probe.sent.at(-1)!.text).toBe("Reply");
		const result = await hook.beforeSend!(message, f.ctx);
		expect(result!.message.text).toBe(`Reply\n\n等你 ${waiting.ref} Need the input\n卡住 ${task.ref} ${content.title}`);
		expect(await hook.beforeSend!(message, f.ctx)).toBeUndefined();
		expect(
			await digest(f.probe.api, new Store(f.probe.api.paths.data), {}).beforeSend!(message, f.ctx),
		).toBeUndefined();
		f.store.done(task.ref, "Delivered", ["one", "two"], f.ctx);
		expect((await hook.beforeSend!(message, f.ctx))!.message.text).toContain(`已交付 ${task.ref}`);
		expect(await hook.beforeSend!(message, f.ctx)).toBeUndefined();
		for (let i = 0; i < 6; i++) {
			const t = f.store.open(content, f.ctx);
			f.store.update(t.ref, { state: "active" }, f.ctx);
			f.store.update(t.ref, { state: "blocked" }, f.ctx);
		}
		expect((await hook.beforeSend!(message, f.ctx))!.message.text.split("\n\n")[1]!.split("\n")).toHaveLength(5);
		expect(
			await digest(f.probe.api, f.store, { tailDigest: { enabled: false } }).beforeSend!(message, f.ctx),
		).toBeUndefined();
	} finally {
		await f.close();
	}
});

test("away digest reads the real event ledger with an injected clock after two hours", async () => {
	const f = await fixture();
	try {
		const event = await f.probe.io.emit({
			type: "message.in",
			from: "acct:reminder:person",
			conv: "conv:reminder:person",
			data: { kind: "dm", text: "Continue" },
		});
		const task = f.store.open(content, f.ctx);
		f.store.update(task.ref, { state: "active" }, f.ctx);
		f.store.update(task.ref, { state: "waiting-user" }, f.ctx);
		const hook = digest(f.probe.api, f.store, {}, () => Date.parse(event.ts) + 2 * 3600000 + 1);
		const message = { to: event.conv!, text: "Back" };
		expect((await hook.beforeSend!(message, f.ctx))!.message.text).toContain(`离开期间 · 等你 ${task.ref}`);
		expect(await hook.beforeSend!(message, f.ctx)).toBeUndefined();
	} finally {
		await f.close();
	}
});
