import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { Check } from "typebox/value";
import { expect, it } from "vitest";
import { fixture } from "../../tasks/test/board-fixture.js";
import plugin from "../src/index.js";

it("satisfies the plugin contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});

it("task card schema keeps optional coordination fields bounded and rejects extra keys", async () => {
	const collector = createRegistrationCollector();
	await plugin.setup(collector.api);
	const schema = collector.registrations.tools.find((tool) => tool.name === "channel-feishu_task_card")?.parameters;
	if (!schema) throw new Error("missing task card schema");
	const row = { id: "task-ref", status: "unverified", deliverable: "交付物", acceptance: "验收点" };
	const args = { instance: "feishu", action: "create", sourceEvent: "input", rows: [row] };
	expect(Check(schema, args)).toBe(true);
	expect(
		Check(schema, {
			...args,
			rows: [{ ...row, assignee: "maintainer", forwardedVerbatim: true }],
			lists: { advancing: ["测试"], needsOwner: [] },
		}),
	).toBe(true);
	for (const invalid of [
		{ ...args, extra: true },
		{ ...args, instance: "" },
		{ ...args, sourceEvent: "" },
		{ instance: "feishu", action: "get", id: "" },
		{ ...args, rows: [{ ...row, authority: true }] },
		{ ...args, rows: [{ ...row, forwardedVerbatim: "yes" }] },
		{ ...args, rows: [{ ...row, assignee: "x".repeat(81) }] },
		{ ...args, rows: Array(13).fill(row) },
		{ ...args, rows: [] },
		{ ...args, lists: { execute: [] } },
		{ ...args, lists: { advancing: Array(4).fill("x") } },
		{ ...args, lists: { needsOwner: ["x".repeat(161)] } },
		{ ...args, rows: [{ ...row, status: "arbitrary prose" }] },
	])
		expect(Check(schema, invalid)).toBe(false);
});

it("creates a board through kernel delivery, patches in place, re-sends on request and falls back on rejection", async () => {
	const requests: Array<{ path: string; method: string; body: any }> = [];
	let rejectCard = false;
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const raw = Buffer.concat(chunks).toString();
		const body = request.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : raw;
		requests.push({ path: request.url!, method: request.method!, body });
		const failed = rejectCard && body.msg_type === "interactive";
		response.writeHead(failed ? 400 : 200, { "Content-Type": "application/json" }).end(
			JSON.stringify(
				failed
					? { code: 999, msg: "Card rejected" }
					: {
							code: 0,
							data: request.url?.includes("/images")
								? { image_key: "local-image" }
								: { message_id: `message-${requests.length}` },
						},
			),
		);
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Protocol listener missing");
	const f = await fixture({}, { feishuBase: `http://127.0.0.1:${address.port}` });
	try {
		const input = {
			title: "Board protocol acceptance",
			objective: "Verify one live card",
			acceptance: ["Created", "Patched"],
			nonGoals: [],
		};
		const task = f.store.open(input, f.ctx);
		const event = await f.probe.io.emit({
			type: "message.in",
			from: "acct:reminder:person",
			conv: "conv:reminder:chat",
			data: { kind: "dm", text: "Board" },
		});
		const show = () => f.call("show", { target: "channel" }, { ...f.ctx, event });
		expect(JSON.parse((await show()).text)).toMatchObject({ ok: true });
		expect(requests).toHaveLength(1);
		const first = requests[0]!;
		expect(first.body.msg_type).toBe("interactive");
		expect(JSON.parse(first.body.content).header.title.content).toContain("v1");
		await f.probe.channel.taskCards.refreshBoards();
		expect(requests).toHaveLength(1);
		f.store.update(task.ref, { state: "active" }, f.ctx);
		f.store.update(task.ref, { state: "waiting-user" }, f.ctx);
		await f.probe.channel.taskCards.refreshBoards();
		expect(requests).toHaveLength(2);
		expect(requests[1]).toMatchObject({ method: "PATCH", path: "/im/v1/messages/message-1" });
		const card = JSON.parse(requests[1]!.body.content);
		expect(card.header.title.content).toContain("v2");
		expect(card.elements[0].text.content).toContain("1 等你 · 0 进行中 · 0 阻塞");
		expect(JSON.parse((await show()).text).id).toBe("message-3");
		expect(requests[2]!.method).toBe("POST");
		f.store.update(task.ref, { state: "blocked" }, f.ctx);
		await f.probe.channel.taskCards.refreshBoards();
		expect(requests[3]).toMatchObject({ method: "PATCH", path: "/im/v1/messages/message-3" });
		expect(JSON.parse(requests[3]!.body.content).header.title.content).toContain("v4");
		rejectCard = true;
		expect(JSON.parse((await show()).text)).toMatchObject({ ok: true });
		expect(requests.slice(4).map((r) => r.body.msg_type ?? "upload")).toEqual(["interactive", "upload", "image"]);
		expect(f.probe.sent.at(-1)!.attachments![0]!.mime).toBe("image/png");
	} finally {
		await f.close();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}, 15000);
