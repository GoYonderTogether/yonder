import { describe, expect, it } from "vitest";
import { inputOf, matchesOf, needListingQuery, taskOf } from "../src/market/needs";
import type { Listing, WatchTask } from "../src/market/types";
import { migrateLegacyNeeds } from "../src/market/watch";

const cloud: WatchTask = {
	id: "w1",
	ownerId: "u1",
	title: "找相机",
	brief: { text: "轻便旅行相机", category: "数码好物", budget: 3000, location: "上海", priority: "price" },
	frequency: "hourly",
	active: true,
	checkedAt: 1_700_000_000_000,
	seenIds: ["a"],
	createdAt: 1_600_000_000_000,
};

function memoryStorage(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
		raw: store,
	};
}

const legacyState = (tasks: unknown[]) =>
	JSON.stringify({ version: 2, tasks, saved: [], liked: [], compare: [], inquiries: [] });
const legacyTask = (id: string, text: string) => ({
	id,
	title: text.slice(0, 8),
	text,
	category: "数码好物",
	budget: 2000,
	location: "上海",
	priority: "最合适",
	frequency: "每天",
	active: true,
	checkedAt: 5,
	seenIds: ["x"],
});

describe("needs ↔ watch_tasks", () => {
	it("keeps cloud facts and maps enum values both ways", () => {
		const task = taskOf(cloud);
		expect(task).toMatchObject({
			id: "w1",
			title: "找相机",
			text: "轻便旅行相机",
			category: "数码好物",
			budget: 3000,
			priority: "价格优先",
			frequency: "每小时",
			active: true,
			checkedAt: 1_700_000_000_000,
			seenIds: ["a"],
		});
		expect(inputOf({ ...task, priority: "同城优先", category: "不限", frequency: "手动" })).toEqual({
			// 标题沿用旧表单规则：由描述的第一句生成，编辑时随描述一起更新。
			title: "轻便旅行相机",
			brief: { text: "轻便旅行相机", category: "any", budget: 3000, location: "上海", priority: "local" },
			frequency: "manual",
		});
	});

	it("queries matches read-only with the task conditions and never its check endpoint", () => {
		expect(needListingQuery(cloud)).toEqual({
			q: "轻便旅行相机",
			category: "数码好物",
			max: "3000",
			sort: "price_asc",
		});
		// 城市只做 `local` 排序加权，公开列表没有该排序；无法核对的字段不进查询。
		expect(needListingQuery(cloud)).not.toHaveProperty("city");
		expect(
			needListingQuery({ ...cloud, brief: { ...cloud.brief, category: "any", budget: 0, priority: "best" } }),
		).toEqual({ q: "轻便旅行相机", sort: "relevance" });
	});

	it("drops the caller's own listings from candidates", () => {
		const listing = { id: "l1", mine: false, price: 100, unit: "", missing: [], location: "上海" } as Listing;
		const mine = { ...listing, id: "l2", mine: true } as Listing;
		expect(matchesOf([listing, mine], taskOf(cloud)).map((m) => m.listing.id)).toEqual(["l1"]);
	});
});

describe("one-time migration of local needs", () => {
	const key = "yonder-market-demo:v1:u1";

	it("creates each local task in the cloud and only then drops the local copy", async () => {
		const storage = memoryStorage({ [key]: legacyState([legacyTask("a", "想找相机"), legacyTask("b", "想找耳机")]) });
		globalThis.localStorage = storage as unknown as Storage;
		const sent: unknown[] = [];
		const result = await migrateLegacyNeeds(key, async (input) => {
			sent.push(input);
			return cloud;
		});
		expect(result).toEqual({ created: 2, remaining: 0 });
		expect(sent).toHaveLength(2);
		expect(sent[0]).toMatchObject({ title: "想找相机", frequency: "daily" });
		expect(JSON.parse(storage.getItem(key) ?? "{}").tasks).toEqual([]);
	});

	it("keeps the unsent tasks and reports the failure when a create fails", async () => {
		const tasks = [legacyTask("a", "想找相机"), legacyTask("b", "想找耳机")];
		const storage = memoryStorage({ [key]: legacyState(tasks) });
		globalThis.localStorage = storage as unknown as Storage;
		let calls = 0;
		const result = await migrateLegacyNeeds(key, async () => {
			calls += 1;
			if (calls === 2) throw new Error("rate_limited");
			return cloud;
		});
		expect(result).toEqual({ created: 1, remaining: 1, error: "rate_limited" });
		const left = JSON.parse(storage.getItem(key) ?? "{}").tasks;
		expect(left).toHaveLength(1);
		expect(left[0].id).toBe("b");
	});

	it("does nothing when the local copy has no tasks and never invents one", async () => {
		const storage = memoryStorage();
		globalThis.localStorage = storage as unknown as Storage;
		const result = await migrateLegacyNeeds(key, async () => {
			throw new Error("must not run");
		});
		expect(result).toEqual({ created: 0, remaining: 0 });
		expect(storage.getItem(key)).toBeNull();
	});
});
