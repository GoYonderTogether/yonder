import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { FeishuApi, FeishuRequestError } from "../src/client.js";
import { FeishuTaskCards } from "../src/task-card.js";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
const chat = "conv:feishu:chat",
	sender = "acct:feishu:initiator";
const rows = [{ id: "task-ref", status: "working", deliverable: "实现", acceptance: "测试" }];
const event = {
	id: "input",
	ts: new Date().toISOString(),
	type: "message.in",
	from: sender,
	conv: chat,
	data: { msgId: "m1", createdAt: "1000" },
} as YEvent;
const ctx = { agent: "agent", session: "session", signal: new AbortController().signal, event } as ToolContext;
async function setup() {
	const home = await mkdtemp(join(tmpdir(), "feishu-task-card-"));
	homes.push(home);
	const emit = vi.fn().mockResolvedValue({ id: "event" });
	const api = { paths: { data: home }, log: { warn: vi.fn() }, events: { emit } } as unknown as PluginAPI;
	const client = new FeishuApi({ appId: "test", secret: "unused" }, api);
	const patch = vi.spyOn(client, "request").mockResolvedValue({ code: 0 });
	const send = vi.fn().mockResolvedValue("om_card");
	const cards = new FeishuTaskCards("feishu", client, api, send);
	await cards.start();
	await cards.observe(chat, sender, "m1", 1000);
	const create = () =>
		cards.execute({ action: "create", sourceEvent: "input", rows }, ctx) as Promise<Record<string, unknown>>;
	return { home, api, client, patch, send, cards, emit, create };
}
it("sends once and edits the same native message; restores the receipt without sending on restart", async () => {
	const { cards, send, patch, create, home, client, api } = await setup();
	const first = await create();
	expect(first).toMatchObject({ messageId: "om_card", revision: 1, state: "confirmed" });
	expect(await create()).toEqual(first);
	expect(send).toHaveBeenCalledTimes(1);
	const next = await cards.execute({ action: "update", id: first.id, expectedRevision: 1, rows }, ctx);
	expect(next).toMatchObject({ messageId: "om_card", revision: 2 });
	expect(patch).toHaveBeenCalledExactlyOnceWith(
		"/im/v1/messages/om_card",
		"PATCH",
		expect.objectContaining({ content: expect.any(String) }),
		ctx.signal,
	);
	const body = JSON.parse(((patch.mock.calls[0] ?? [])[2] as { content: string }).content);
	expect(body.config.update_multi).toBe(true);
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(await restarted.execute({ action: "get", id: first.id }, ctx)).toEqual(next);
	expect(send).toHaveBeenCalledTimes(1);
	expect(JSON.parse(await readFile(join(home, "feishu", "task-cards.json"), "utf8")).receipts).toHaveLength(1);
});
it("CAS allows only one competing update and rejects cross-session/agent reads", async () => {
	const { cards, create, patch } = await setup();
	const first = await create();
	const args = { action: "update", id: first.id, expectedRevision: 1, rows };
	const results = await Promise.allSettled([cards.execute(args, ctx), cards.execute(args, ctx)]);
	expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
	expect(patch).toHaveBeenCalledTimes(1);
	await expect(cards.execute({ action: "get", id: first.id }, { ...ctx, session: "other" })).rejects.toThrow(
		"another session",
	);
	await expect(cards.execute({ action: "get", id: first.id }, { ...ctx, agent: "other" })).rejects.toThrow(
		"another session",
	);
});
it("new initiating-user text retires the old anchor and strips buttons; stale create/update cannot touch the next card", async () => {
	const { cards, create, patch, send } = await setup();
	const first = await create();
	await cards.observe(chat, sender, "m2", 2000);
	const body = JSON.parse(((patch.mock.calls[0] ?? [])[2] as { content: string }).content);
	expect(body.elements.filter((e: { tag: string }) => e.tag === "action")).toHaveLength(0);
	await expect(cards.execute({ action: "update", id: first.id, expectedRevision: 1, rows }, ctx)).rejects.toThrow(
		"retired",
	);
	await expect(create()).rejects.toThrow("no longer the latest");
	const nextCtx = { ...ctx, event: { ...event, id: "input2", data: { msgId: "m2", createdAt: "2000" } } };
	const second = await cards.execute({ action: "create", sourceEvent: "input2", rows }, nextCtx);
	expect(second).not.toHaveProperty("id", first.id);
	expect(send).toHaveBeenCalledTimes(2);
});
it("a different group member cannot confirm or retire the initiating user's card", async () => {
	const { cards, create, emit, patch } = await setup();
	const first = await create();
	emit.mockClear();
	await cards.observe(chat, "acct:feishu:other", "other-message", 3000);
	const value = { yonder_task_card: first.id, revision: 1, action: "acknowledge" };
	expect(await cards.callback("acct:feishu:other", chat, "om_card", value)).toHaveProperty("toast.type", "error");
	expect(await cards.callback(sender, "conv:feishu:other", "om_card", value)).toHaveProperty("toast.type", "error");
	expect(await cards.callback(sender, chat, "om_wrong", value)).toHaveProperty("toast.type", "error");
	expect(patch).not.toHaveBeenCalled();
	expect(emit).not.toHaveBeenCalled();
});
it("details uses existing task references only; repeated callback is idempotent; acknowledgment grants no authority", async () => {
	const { cards, create, emit, patch } = await setup();
	const first = await create();
	emit.mockClear();
	const value = { yonder_task_card: first.id, revision: 1, action: "details" };
	expect(await cards.callback(sender, chat, "om_card", value)).toHaveProperty("toast.type", "success");
	await cards.callback(sender, chat, "om_card", value);
	expect(emit).toHaveBeenCalledTimes(1);
	expect(emit.mock.calls[0]?.[0]).toMatchObject({
		type: "channel-feishu.card-action",
		data: { authorization: "none", action: { value: { taskIds: ["task-ref"] } } },
	});
	expect(JSON.stringify(emit.mock.calls[0]?.[0])).not.toContain("验收");
	const ack = { ...value, action: "acknowledge" };
	await cards.callback(sender, chat, "om_card", ack);
	await cards.callback(sender, chat, "om_card", ack);
	await cards.execute({ action: "get", id: first.id }, ctx);
	expect(emit).toHaveBeenCalledTimes(2);
	expect(patch).toHaveBeenCalledTimes(1);
	expect(await cards.execute({ action: "get", id: first.id }, ctx)).toMatchObject({ acknowledged: true, revision: 2 });
});
it("retirement remains server-side effective even if visual removal fails, including restart", async () => {
	const { cards, create, patch, api, client, send } = await setup();
	const first = await create();
	patch.mockRejectedValueOnce(new FeishuRequestError("timeout", true));
	await cards.observe(chat, sender, "m2", 2000);
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(
		await restarted.callback(sender, chat, "om_card", {
			yonder_task_card: first.id,
			revision: 1,
			action: "acknowledge",
		}),
	).toHaveProperty("toast.type", "error");
	expect(await restarted.execute({ action: "get", id: first.id }, ctx)).toMatchObject({
		retired: true,
		state: "unknown",
	});
	expect(patch).toHaveBeenCalledTimes(1);
});
it("unknown create returns a durable ID and never resends on duplicate creation/restart", async () => {
	const { create, send, api, client } = await setup();
	send.mockRejectedValueOnce(new FeishuRequestError("lost receipt", true));
	const first = await create();
	expect(first).toMatchObject({ ok: false, state: "unknown", retry: "forbidden" });
	expect(first.id).toBeTypeOf("string");
	await create();
	expect(send).toHaveBeenCalledTimes(1);
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	await restarted.execute({ action: "create", sourceEvent: "input", rows }, ctx);
	expect(send).toHaveBeenCalledTimes(1);
});
it("unknown update blocks subsequent mutations and rejects old-revision buttons", async () => {
	const { cards, create, patch } = await setup();
	const first = await create();
	patch.mockRejectedValueOnce(new FeishuRequestError("lost patch receipt", true));
	expect(await cards.execute({ action: "update", id: first.id, expectedRevision: 1, rows }, ctx)).toMatchObject({
		ok: false,
		state: "unknown",
		revision: 2,
	});
	await expect(cards.execute({ action: "update", id: first.id, expectedRevision: 2, rows }, ctx)).rejects.toThrow(
		"unknown",
	);
	expect(
		await cards.callback(sender, chat, "om_card", { yonder_task_card: first.id, revision: 1, action: "details" }),
	).toHaveProperty("toast.type", "error");
	expect(patch).toHaveBeenCalledTimes(1);
});
it("restart treats persisted pending operations as unknown and never replays them", async () => {
	const { cards, create, home, api, client, send, patch } = await setup();
	const first = await create();
	const path = join(home, "feishu", "task-cards.json"),
		stored = JSON.parse(await readFile(path, "utf8"));
	stored.receipts[0].state = "pending";
	await writeFile(path, JSON.stringify(stored));
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(await restarted.execute({ action: "get", id: first.id }, ctx)).toMatchObject({ state: "unknown" });
	expect(send).toHaveBeenCalledTimes(1);
	expect(patch).not.toHaveBeenCalled();
	await cards.stop();
});
it("a new input arriving during send retires and removes buttons from that same message", async () => {
	const { cards, create, send, patch } = await setup();
	let finish!: (id: string) => void, started!: () => void;
	const sending = new Promise<void>((resolve) => {
		started = resolve;
	});
	send.mockImplementationOnce(() => {
		started();
		return new Promise<string>((resolve) => {
			finish = resolve;
		});
	});
	const creating = create();
	await sending;
	const retiring = cards.observe(chat, sender, "m2", 2000);
	finish("om_late");
	const receipt = await creating;
	await retiring;
	expect(receipt).toMatchObject({ messageId: "om_late", retired: true });
	for (const call of patch.mock.calls)
		expect(
			JSON.parse((call[2] as { content: string }).content).elements.some((e: { tag: string }) => e.tag === "action"),
		).toBe(false);
	expect(send).toHaveBeenCalledTimes(1);
});
it("rejects source fabrication, non-latest inputs, old history and expired actions", async () => {
	const { cards, create, patch, home, client, api, send } = await setup();
	await expect(cards.execute({ action: "create", sourceEvent: "forged", rows }, ctx)).rejects.toThrow("actual Feishu");
	await cards.observe(chat, sender, "old", 999);
	const first = await create();
	const path = join(home, "feishu", "task-cards.json"),
		stored = JSON.parse(await readFile(path, "utf8"));
	stored.receipts[0].created = Date.now() - 15 * 86400000;
	await writeFile(path, JSON.stringify(stored));
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(
		await restarted.callback(sender, chat, "om_card", {
			yonder_task_card: first.id,
			revision: 1,
			action: "acknowledge",
		}),
	).toHaveProperty("toast.type", "error");
	expect(patch).not.toHaveBeenCalled();
});
it("responds to callbacks without waiting behind an in-flight remote PATCH", async () => {
	const { cards, create, patch } = await setup();
	const first = await create();
	let finish!: () => void, started!: () => void;
	const updating = new Promise<void>((resolve) => {
		started = resolve;
	});
	patch.mockImplementationOnce(() => {
		started();
		return new Promise((resolve) => {
			finish = () => resolve({ code: 0 });
		});
	});
	const work = cards.execute({ action: "update", id: first.id, expectedRevision: 1, rows }, ctx);
	await updating;
	expect(
		await cards.callback(sender, chat, "om_card", { yonder_task_card: first.id, revision: 1, action: "details" }),
	).toHaveProperty("toast.type", "info");
	finish();
	await work;
});

it("renders fixed four-color labels, optional coordination claims and two short lists on the same card", async () => {
	const { cards, send, patch } = await setup();
	const first = (await cards.execute(
		{
			action: "create",
			sourceEvent: "input",
			rows: [
				...["queued", "working", "done", "blocked", "unverified"].map((status) => ({ ...rows[0], status })),
				{ ...rows[0], assignee: "maintainer", forwardedVerbatim: true },
				{ ...rows[0], forwardedVerbatim: false },
			],
			lists: { advancing: ["继续测试\n无需操作"], needsOwner: ["确认验收标准"] },
		},
		ctx,
	)) as { id: string };
	const card = send.mock.calls[0]?.[1] as {
		elements: { tag: string; columns?: { elements: { text: { content: string } }[] }[] }[];
	};
	const cells = card.elements
		.filter((element) => element.tag === "column_set")
		.map((element) => element.columns?.map((column) => column.elements[0]?.text.content));
	expect(cells[0]).toEqual(["状态", "任务", "负责人", "原文程序转发", "交付物", "验收点"]);
	expect(cells.slice(1, 6).map((row) => row?.[0])).toEqual([
		"⚪ 待开始",
		"🟡 实现中",
		"🟢 已完成",
		"🔴 已阻塞",
		"⚪ 未验收",
	]);
	expect(cells[6]?.slice(2, 4)).toEqual(["maintainer", "是"]);
	expect(cells[7]?.slice(2, 4)).toEqual(["未注明", "否"]);
	const rendered = JSON.stringify(card);
	for (const label of [
		"⚪ 待开始",
		"🟡 实现中",
		"🟢 已完成",
		"🔴 已阻塞",
		"⚪ 未验收",
		"负责人",
		"原文程序转发",
		"maintainer",
		"未注明",
		"我在推进，无需您操作",
		"需要您处理",
		"确认验收标准",
		"确认收到（仅通知）",
	])
		expect(rendered).toContain(label);
	expect(rendered).not.toMatch(/🟣|🟠|进行下一个任务/);
	await cards.execute({ action: "update", id: first.id, expectedRevision: 1, rows }, ctx);
	expect(JSON.stringify(patch.mock.calls[0]?.[2])).toContain("确认验收标准");
	await cards.execute(
		{ action: "update", id: first.id, expectedRevision: 2, rows, lists: { advancing: [], needsOwner: [] } },
		ctx,
	);
	expect(JSON.stringify(patch.mock.calls[1]?.[2])).not.toContain("确认验收标准");
});

it.each(["details", "acknowledge"])(
	"%s emit failure is unknown, not success, and never replays after restart",
	async (action) => {
		const { cards, create, emit, patch, client, api, send } = await setup();
		const first = await create();
		emit.mockClear();
		emit.mockRejectedValueOnce(new Error("admission response lost"));
		const value = { yonder_task_card: first.id, revision: 1, action };
		expect(await cards.callback(sender, chat, "om_card", value)).toMatchObject({
			toast: { type: "error", content: expect.stringContaining("未知") },
		});
		const receipt = await cards.execute({ action: "get", id: first.id }, ctx);
		expect(receipt).toMatchObject({
			notifications: { [`1:${action}`]: "unknown" },
			acknowledged: action === "acknowledge",
		});
		await cards.callback(sender, chat, "om_card", value);
		const restarted = new FeishuTaskCards("feishu", client, api, send);
		await restarted.start();
		await restarted.callback(sender, chat, "om_card", value);
		expect(emit).toHaveBeenCalledTimes(1);
		expect(patch).not.toHaveBeenCalled();
	},
);

it("restart exposes a pending consumed notification as unknown without emitting", async () => {
	const { create, home, api, client, send, emit } = await setup();
	const first = await create();
	const path = join(home, "feishu", "task-cards.json"),
		stored = JSON.parse(await readFile(path, "utf8"));
	stored.receipts[0].actions = ["1:details"];
	stored.receipts[0].notifications = { "1:details": "pending" };
	await writeFile(path, JSON.stringify(stored));
	emit.mockClear();
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(await restarted.execute({ action: "get", id: first.id }, ctx)).toMatchObject({
		notifications: { "1:details": "unknown" },
	});
	expect(
		await restarted.callback(sender, chat, "om_card", { yonder_task_card: first.id, revision: 1, action: "details" }),
	).toHaveProperty("toast.type", "error");
	expect(emit).not.toHaveBeenCalled();
});

it("observe invalidates before persistence but restart can only restore the last saved source until recovery observes it again", async () => {
	const { cards, create, home, api, client, send, emit, patch } = await setup();
	const first = await create();
	const directory = join(home, "feishu"),
		backup = join(home, "saved");
	await rename(directory, backup);
	await writeFile(directory, "not a directory");
	await expect(cards.observe(chat, sender, "m2", 2000)).rejects.toThrow();
	const value = { yonder_task_card: first.id, revision: 1, action: "details" };
	expect(await cards.callback(sender, chat, "om_card", value)).toHaveProperty("toast.type", "error");
	await rm(directory);
	await rename(backup, directory);
	const restarted = new FeishuTaskCards("feishu", client, api, send);
	await restarted.start();
	expect(await restarted.execute({ action: "get", id: first.id }, ctx)).toMatchObject({ retired: false });
	await restarted.observe(chat, sender, "m2", 2000);
	expect(await restarted.callback(sender, chat, "om_card", value)).toHaveProperty("toast.type", "error");
	expect(patch).toHaveBeenCalledTimes(1);
	expect(emit).toHaveBeenCalledTimes(1);
});

it("notification consumption save failure never emits or returns success", async () => {
	const { cards, create, home, emit } = await setup();
	const first = await create();
	emit.mockClear();
	const directory = join(home, "feishu"),
		backup = join(home, "saved");
	await rename(directory, backup);
	await writeFile(directory, "not a directory");
	const value = { yonder_task_card: first.id, revision: 1, action: "acknowledge" };
	expect(await cards.callback(sender, chat, "om_card", value)).toHaveProperty("toast.type", "error");
	await cards.callback(sender, chat, "om_card", value);
	expect(emit).not.toHaveBeenCalled();
	await rm(directory);
	await rename(backup, directory);
});

it("confirmed emit followed by failed receipt save is unknown and never re-emits", async () => {
	const { cards, create, home, emit } = await setup();
	const first = await create();
	emit.mockClear();
	const directory = join(home, "feishu"),
		backup = join(home, "saved");
	emit.mockImplementationOnce(async () => {
		await rename(directory, backup);
		await writeFile(directory, "not a directory");
		return { id: "admitted" };
	});
	const value = { yonder_task_card: first.id, revision: 1, action: "details" };
	expect(await cards.callback(sender, chat, "om_card", value)).toHaveProperty("toast.type", "error");
	await rm(directory);
	await rename(backup, directory);
	await cards.callback(sender, chat, "om_card", value);
	expect(emit).toHaveBeenCalledTimes(1);
});

it("rejects an oversized composite card without sending any message", async () => {
	const { cards, send } = await setup();
	const result = await cards.execute(
		{
			action: "create",
			sourceEvent: "input",
			rows: Array.from({ length: 12 }, () => ({
				...rows[0],
				id: "界".repeat(80),
				assignee: "界".repeat(80),
				deliverable: "界".repeat(160),
				acceptance: "界".repeat(160),
			})),
			lists: { advancing: Array(3).fill("界".repeat(160)), needsOwner: Array(3).fill("界".repeat(160)) },
		},
		ctx,
	);
	expect(result).toMatchObject({ ok: false, error: expect.stringContaining("30000") });
	expect(send).not.toHaveBeenCalled();
});
