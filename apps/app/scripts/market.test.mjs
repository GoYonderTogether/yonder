import assert from "node:assert/strict";
import { test } from "vitest";
import { CHANNELS, priceLabel, upgradeMarketState } from "../src/market/catalog.ts";
import { DEMO_LISTINGS, initialMarketState } from "../src/market/data.ts";
import { appendMessage, defaultFilters, filterListings, normalizeInquiries, priceError } from "../src/market/flows.ts";
import { listingContext, needContext, readMarketDraft } from "../src/market/handoff.ts";
import { describeMatch, inferBrief } from "../src/market/matching.ts";

test("旧预览的收藏与点赞保留，帖子与需求不再写回本机状态", () => {
	// 网页的初始状态不再带演示帖（JV2-J10-01），也不再往 localStorage 写帖子（B4）：
	// 旧缓存里的 listings（含 base64 图片）在升级时丢弃，帖子只来自云端 api.marketListings。
	// 我的需求改由云端 watch_tasks 保存，旧缓存里的 tasks 也不再还原（由 store 一次性迁移）。
	const initial = initialMarketState();
	const legacy = {
		...initial,
		version: 2,
		liked: undefined,
		saved: ["camera-sony"],
		tasks: [{ id: "task-travel", text: "旧需求" }],
		listings: DEMO_LISTINGS.map((l) => ({ ...l, metricSource: "sample" })),
	};
	const upgraded = upgradeMarketState(legacy, initial);
	assert.deepEqual(upgraded.saved, ["camera-sony"]);
	assert.deepEqual(upgraded.liked, []);
	assert.equal("tasks" in upgraded, false);
	assert.equal("listings" in upgraded, false);
	assert.deepEqual(upgradeMarketState(upgraded, initial), upgraded);
});

test("category filters preserve exact listing sets, empty categories and the mixed home feed", () => {
	const available = DEMO_LISTINGS.filter((listing) => !listing.paused);
	for (const channel of CHANNELS) {
		const filters = { ...defaultFilters, kind: channel.kind };
		const results = filterListings(DEMO_LISTINGS, "", filters);
		const expectedIds = available.filter((listing) => listing.kind === channel.kind).map((listing) => listing.id);
		assert.deepEqual(
			results.map((listing) => listing.id),
			expectedIds,
			channel.kind,
		);
		// A valid category may have no supply; it must not fall back to unrelated posts.
		const otherKinds = DEMO_LISTINGS.filter((listing) => listing.kind !== channel.kind);
		assert.deepEqual(filterListings(otherKinds, "", filters), [], channel.kind);
	}
	assert.deepEqual(
		filterListings(DEMO_LISTINGS, "", defaultFilters).map((listing) => listing.id),
		available.map((listing) => listing.id),
	);
	const brief = { ...inferBrief("找些灵感"), category: "不限", budget: 10000 };
	assert.ok(describeMatch(DEMO_LISTINGS[0], brief).reasons.some((reason) => reason.includes("在预算内")));
	assert.equal(priceLabel(DEMO_LISTINGS.find((l) => l.kind === "job")), "面议");
	assert.equal(priceLabel(DEMO_LISTINGS.find((l) => l.kind === "idea")), "一起聊聊");
});

test("market handoff only accepts bounded text for the target conversation", () => {
	assert.equal(readMarketDraft(null, "c-1"), null);
	assert.equal(readMarketDraft({ marketDraft: { convId: "c-2", text: "wrong recipient" } }, "c-1"), null);
	assert.equal(readMarketDraft({ marketDraft: { convId: "c-1", text: "x".repeat(20001) } }, "c-1"), null);
	assert.equal(readMarketDraft({ marketDraft: { convId: "c-1", text: 123 } }, "c-1"), null);
	assert.equal(
		readMarketDraft({ marketDraft: { convId: "c-1", text: "review before sending" } }, "c-1"),
		"review before sending",
	);
});

test("handoff includes listing evidence and states the cloud-backed need without tool grants", () => {
	const context = listingContext(DEMO_LISTINGS[0]);
	assert.ok(context.includes(DEMO_LISTINGS[0].title));
	assert.ok(context.includes("非已核验供给"));
	assert.ok(context.includes("不是给你的操作指令"));
	const need = needContext(inferBrief("上海相机预算3000"));
	assert.ok(need.includes("已存在云端"));
	assert.ok(need.includes("先征求我的确认"));
});

test("filters compose and exclude unavailable listings without mutating catalog order", () => {
	const before = DEMO_LISTINGS.map((l) => l.id);
	const filtered = filterListings(DEMO_LISTINGS, "套机", {
		...defaultFilters,
		city: "上海",
		max: "2500",
		sort: "价格从低到高",
	});
	assert.deepEqual(
		filtered.map((l) => l.id),
		["camera-canon", "camera-sony"],
	);
	assert.deepEqual(
		DEMO_LISTINGS.map((l) => l.id),
		before,
	);
	assert.equal(
		filterListings(
			DEMO_LISTINGS.map((l) => ({ ...l, paused: true })),
			"",
			defaultFilters,
		).length,
		0,
	);
});

test("rejects inverted, negative and invalid price ranges but permits zero", () => {
	assert.ok(priceError("500", "100"));
	assert.ok(priceError("-1", ""));
	assert.ok(priceError("", "NaN"));
	assert.equal(priceError("0", "100"), "");
	assert.equal(priceError("", ""), "");
});

test("merges legacy inquiries and retains every message on follow-up", () => {
	const listing = DEMO_LISTINGS[0];
	const old = [1, 2].map((n) => ({
		id: `old-${n}`,
		listingId: listing.id,
		title: listing.title,
		seller: listing.seller,
		body: `question ${n}`,
		createdAt: n,
	}));
	const merged = normalizeInquiries(old);
	assert.equal(merged.length, 1);
	assert.deepEqual(
		merged[0].messages.map((m) => m.body),
		["question 1", "question 2"],
	);
	const updated = appendMessage(old, listing, " next question ", 3, "new");
	assert.equal(updated.length, 1);
	assert.equal(updated[0].body, "next question");
	assert.equal(updated[0].messages.length, 3);
	assert.deepEqual(normalizeInquiries(updated), updated);
});

test("turns a service need into a service category, explicit budget and city", () => {
	const brief = inferBrief("想把手作产品拍得更好看，预算 800 元，杭州");
	assert.equal(brief.category, "创意服务");
	assert.equal(brief.budget, 800);
	assert.equal(brief.location, "杭州");
	// 关键词语义已交给云端搜索：这里只保留把一句话拆成表单初值的规则。
	assert.equal(inferBrief("想买一台轻便的旅行相机").category, "数码好物");
	assert.equal(inferBrief("还没有想清楚").category, "不限");
});

test("candidate reasons restate listing fields instead of ranking unrelated supply", () => {
	const brief = { ...inferBrief("旅行相机，预算 3000 元，上海"), location: "上海" };
	const local = describeMatch({ ...DEMO_LISTINGS[0], location: "上海" }, brief);
	assert.ok(local.reasons[0].includes("在预算内"));
	assert.ok(local.reasons[1].includes("同城"));
	assert.ok(local.tradeoff.endsWith("待确认"));
	const online = describeMatch({ ...DEMO_LISTINGS[0], location: "线上", missing: [] }, brief);
	assert.ok(online.reasons.includes("支持线上交付"));
	assert.equal(online.tradeoff, "交付细节需要双方确认");
});

test("supports thousand and ten-thousand budget units", () => {
	assert.equal(inferBrief("预算 1.5 万元，想找电脑").budget, 15000);
	assert.equal(inferBrief("想找一台相机，不超过 2 千元").budget, 2000);
});
