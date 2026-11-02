import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Market } from "../src/pages/Market";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({
	marketCapabilities: vi.fn(),
	marketListings: vi.fn(),
	marketListing: vi.fn(),
	listWatchTasks: vi.fn(),
	createWatchTask: vi.fn(),
	updateWatchTask: vi.fn(),
	deleteWatchTask: vi.fn(),
	contacts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

const task = {
	id: "w1",
	ownerId: "me",
	title: "找相机",
	brief: { text: "轻便相机", category: "数码好物", budget: 3000, location: "上海", priority: "best" },
	frequency: "manual",
	active: true,
	checkedAt: Date.now() - 60_000,
	seenIds: ["old"],
	createdAt: 1,
};
const listing = (id: string, mine = false) => ({
	id,
	mine,
	kind: "item",
	category: "数码好物",
	title: `相机 ${id}`,
	description: "",
	price: 2000,
	unit: "",
	image: "",
	seller: "阿原",
	sellerRole: "个人",
	location: "上海",
	tags: [],
	facts: [],
	delivery: "面交",
	missing: ["快门次数"],
	agent: false,
	createdAt: 1,
	metrics: { agentViews: 0, shortlists: 0, humanViews: 0, inquiries: 0 },
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	Object.getPrototypeOf(document.createElement("div")).scrollTo = () => {};
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
	});
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
	api.contacts.mockResolvedValue([]);
	api.marketCapabilities.mockResolvedValue({ listingPolicy: true, sellerShops: true });
	api.marketListings.mockResolvedValue({ items: [] });
	api.listWatchTasks.mockResolvedValue([task]);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});

afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render(path: string) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<Routes>
						<Route path="/me/market/:section" element={<Market />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);
	});
	for (let i = 0; i < 4; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	return container.textContent ?? "";
}

describe("我的需求读云端 watch_tasks", () => {
	it("lists cloud tasks and queries matches read-only, never the check endpoint", async () => {
		api.marketListings.mockResolvedValue({ items: [listing("a"), listing("mine", true)] });
		const text = await render("/me/market/needs");
		expect(api.listWatchTasks).toHaveBeenCalled();
		expect(text).toContain("找相机");
		// 只读搜索：用需求条件查公开帖子列表，并且不带 cursor/mine。
		expect(api.marketListings).toHaveBeenCalledWith(
			expect.objectContaining({ q: "轻便相机", category: "数码好物", max: "3000", sort: "relevance" }),
		);
		expect(api.updateWatchTask).not.toHaveBeenCalled();
	});

	it("shows a load error instead of an empty list when the cloud rejects", async () => {
		api.listWatchTasks.mockRejectedValue(new Error("市场服务正在更新"));
		const text = await render("/me/market/needs");
		expect(text).toContain("需求暂时无法加载");
		expect(text).not.toContain("还没有保存的需求");
	});

	it("saves a new need through createWatchTask and drops the stale local copy only after success", async () => {
		const legacy = {
			version: 2,
			tasks: [
				{
					id: "local-1",
					title: "旧需求",
					text: "想找相机",
					category: "数码好物",
					budget: 2000,
					location: "上海",
					priority: "最合适",
					frequency: "手动",
					active: true,
					checkedAt: 1,
					seenIds: [],
				},
			],
			saved: [],
			liked: [],
			compare: [],
			inquiries: [],
		};
		localStorage.setItem("yonder-market-demo:v1:me", JSON.stringify(legacy));
		api.createWatchTask.mockResolvedValue({ ...task, id: "w2" });
		await render("/me/market/needs");
		expect(api.createWatchTask).toHaveBeenCalledWith(expect.objectContaining({ title: "旧需求", frequency: "manual" }));
		expect(JSON.parse(localStorage.getItem("yonder-market-demo:v1:me") ?? "{}").tasks).toEqual([]);
	});

	it("keeps the local copy and does not report success when the cloud write fails", async () => {
		const local = {
			id: "local-1",
			title: "旧需求",
			text: "想找相机",
			category: "数码好物",
			budget: 2000,
			location: "上海",
			priority: "最合适",
			frequency: "手动",
			active: true,
			checkedAt: 1,
			seenIds: [],
		};
		localStorage.setItem(
			"yonder-market-demo:v1:me",
			JSON.stringify({ version: 2, tasks: [local], saved: [], liked: [], compare: [], inquiries: [] }),
		);
		api.createWatchTask.mockRejectedValue(new Error("rate_limited"));
		const text = await render("/me/market/needs");
		expect(text).toContain("找相机");
		expect(JSON.parse(localStorage.getItem("yonder-market-demo:v1:me") ?? "{}").tasks).toHaveLength(1);
	});
});
