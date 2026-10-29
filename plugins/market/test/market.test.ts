import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { MarketClient } from "../src/client.js";
import plugin from "../src/index.js";
import { WatchRunner } from "../src/watch.js";
import { type FakeCloud, fakeApi, fakeCloud, type Harness } from "./harness.js";

const HOUR = 60 * 60 * 1000;

let cloud: FakeCloud;
let harness: Harness;

async function setup(options: { signedOut?: boolean } = {}): Promise<Harness> {
	const created = fakeApi({
		data: await mkdtemp(join(tmpdir(), "market-test-")),
		config: { endpoint: cloud.base },
		...(options.signedOut === true ? { signedOut: true } : {}),
	});
	await plugin.setup(created.api);
	return created;
}

/** 工具结果统一是 `{ok, …}` 的 JSON 文本。 */
async function result(promise: Promise<{ text: string }>): Promise<Record<string, unknown>> {
	return JSON.parse((await promise).text) as Record<string, unknown>;
}

beforeEach(async () => {
	cloud = await fakeCloud();
	harness = await setup();
});

afterEach(async () => {
	await cloud.close();
});

it("searches the cloud with the device token", async () => {
	const found = await result(harness.run("search", { q: "相机" }));
	expect(found).toMatchObject({ ok: true, nextCursor: "next-1" });
	expect(found.items).toHaveLength(1);
	const call = cloud.calls[0];
	expect(call).toMatchObject({ method: "GET", path: "/api/market/listings", authorization: "Bearer device-token" });
	expect(call?.query.get("q")).toBe("相机");
	expect(call?.query.get("limit")).toBe("10");
});

it("reads one listing and its inquiries when asked", async () => {
	const read = await result(harness.run("get", { id: "l1", includeInquiries: true }));
	expect(read).toMatchObject({ ok: true, listing: { id: "l1" } });
	expect(read.inquiries).toHaveLength(1);
	expect(cloud.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
		"GET /api/market/listings/l1",
		"GET /api/market/inquiries",
	]);
	expect(cloud.calls[1]?.query.get("role")).toBe("seller");
});

it("passes cloud error codes through", async () => {
	expect(await result(harness.run("get", { id: "missing" }))).toEqual({ ok: false, error: "not_found" });
});

it("refuses publish without owner approval and never calls the cloud", async () => {
	expect(await result(harness.run("publish", { action: "pause", id: "l1", ownerApproved: false }))).toEqual({
		ok: false,
		error: "approval_required",
	});
	expect(
		await result(
			harness.run("publish", {
				action: "create",
				ownerApproved: false,
				listing: {
					kind: "item",
					category: "数码好物",
					title: "相机",
					description: "九成新",
					price: 1200,
					location: "上海",
				},
			}),
		),
	).toEqual({ ok: false, error: "approval_required" });
	expect(cloud.calls).toHaveLength(0);
});

it("publishes, updates, pauses and resumes an approved listing", async () => {
	const created = await result(
		harness.run("publish", {
			action: "create",
			ownerApproved: true,
			listing: {
				kind: "item",
				category: "数码好物",
				title: "相机",
				description: "九成新",
				price: 1200,
				location: "上海",
			},
		}),
	);
	expect(created).toMatchObject({ ok: true, id: "l-new" });
	expect(cloud.calls[0]).toMatchObject({ method: "POST", path: "/api/market/listings" });
	expect(cloud.calls[0]?.body).toMatchObject({ title: "相机", price: 1200 });

	const updated = await result(
		harness.run("publish", { action: "update", id: "l1", ownerApproved: true, listing: { price: 1000 } }),
	);
	expect(updated).toMatchObject({ ok: true, id: "l1" });
	expect(cloud.calls[1]).toMatchObject({ method: "PATCH", path: "/api/market/listings/l1", body: { price: 1000 } });

	expect(await result(harness.run("publish", { action: "pause", id: "l1", ownerApproved: true }))).toMatchObject({
		ok: true,
		status: "paused",
	});
	expect(await result(harness.run("publish", { action: "resume", id: "l1", ownerApproved: true }))).toMatchObject({
		ok: true,
		status: "active",
	});
});

it("lists and reads inquiries without approval, sends and replies only with it", async () => {
	const listed = await result(harness.run("inquire", { action: "list", listingId: "l1" }));
	expect(listed.items).toHaveLength(1);
	expect(cloud.calls[0]?.query.get("listingId")).toBe("l1");

	expect(await result(harness.run("inquire", { action: "read", inquiryId: "q1" }))).toMatchObject({
		ok: true,
		id: "q1",
	});

	expect(await result(harness.run("inquire", { action: "send", listingId: "l1", body: "还有吗" }))).toEqual({
		ok: false,
		error: "approval_required",
	});
	expect(cloud.calls).toHaveLength(2);

	expect(
		await result(harness.run("inquire", { action: "send", listingId: "l1", body: "还有吗", ownerApproved: true })),
	).toMatchObject({ ok: true, id: "q2" });
	expect(cloud.calls[2]).toMatchObject({
		method: "POST",
		path: "/api/market/listings/l1/inquiries",
		body: { body: "还有吗" },
	});

	expect(
		await result(harness.run("inquire", { action: "reply", inquiryId: "q1", body: "在的", ownerApproved: true })),
	).toMatchObject({ ok: true, lastMessage: "在的" });
	expect(cloud.calls[3]).toMatchObject({ method: "POST", path: "/api/market/inquiries/q1/messages" });
});

it("reports not_signed_in instead of calling the cloud without a credential", async () => {
	const anonymous = await setup({ signedOut: true });
	expect(await result(anonymous.run("search", {}))).toEqual({ ok: false, error: "not_signed_in" });
	expect(cloud.calls).toHaveLength(0);
});

it("manages watch tasks against the cloud", async () => {
	const created = await result(
		harness.run("watch", {
			action: "create",
			title: "找相机",
			frequency: "hourly",
			brief: { text: "找一台二手相机", category: "数码好物", budget: 1500, location: "上海", priority: "best" },
		}),
	);
	expect(created).toMatchObject({ ok: true, id: "w9" });
	expect(cloud.calls[0]?.body).toMatchObject({ frequency: "hourly", active: true, title: "找相机" });

	expect(await result(harness.run("watch", { action: "list" }))).toMatchObject({ ok: true });
	expect(cloud.calls[1]).toMatchObject({ method: "GET", path: "/api/market/watch-tasks" });

	expect(await result(harness.run("watch", { action: "check", id: "w1" }))).toMatchObject({
		ok: true,
		items: [{ id: "l9" }],
	});
	expect(cloud.calls[2]).toMatchObject({ method: "POST", path: "/api/market/watch-tasks/w1/check" });

	expect(await result(harness.run("watch", { action: "delete", id: "w1" }))).toEqual({
		ok: true,
		id: "w1",
		deleted: true,
	});
	expect(cloud.calls[3]).toMatchObject({ method: "DELETE", path: "/api/market/watch-tasks/w1" });
});

it("announces each watch match once, in the owner's main session", async () => {
	const runner = new WatchRunner(harness.api, async () => new MarketClient(cloud.base, "device-token"));
	await runner.start();
	try {
		await runner.apply(
			{ id: "w1", title: "找相机", frequency: "hourly", active: true, checkedAt: Date.now() - 2 * HOUR },
			"main",
		);
		await runner.tick(Date.now());
		expect(harness.notifications).toHaveLength(1);
		expect(harness.notifications[0]?.session).toBe("1");
		expect(harness.notifications[0]?.text).toContain("找相机");
		expect(harness.notifications[0]?.text).toContain("l9");

		// 云端再次返回同一 id（例如 seenIds 未生效）：本地兜底，不重复提示。
		await runner.tick(Date.now() + 2 * HOUR);
		expect(harness.notifications).toHaveLength(1);

		cloud.state.checkItems = [{ id: "l10", title: "胶片机", price: 300, location: "杭州" }];
		await runner.tick(Date.now() + 4 * HOUR);
		expect(harness.notifications).toHaveLength(2);
		expect(harness.notifications[1]?.text).toContain("l10");
	} finally {
		await runner.stop();
	}
});

it("shows own listings, unread inquiries and watch tasks in the panel", async () => {
	const view = harness.views[0];
	expect(view?.decl).toMatchObject({ id: "market.panel", plugin: "market", placement: "rail" });
	const data = await view?.provider.data();
	expect(data?.viewId).toBe("market.panel");
	expect(data?.badge).toBe(2);
	const content = data?.content;
	if (content?.type !== "list") throw new Error("expected a list view");
	expect(content.items.map((item) => item.id)).toEqual(["listing:l1", "inquiry:q1", "watch:w1"]);
	expect(content.items[1]?.state).toBe("doing");
});
