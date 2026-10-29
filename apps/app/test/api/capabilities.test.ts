import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../src/work/api/client", () => ({ rpc }));

const facts = (over: { methods?: Record<string, unknown>; events?: string[]; kind?: "local" | "remote" } = {}) => ({
	protocol: 1,
	minor: 1,
	kind: over.kind ?? "local",
	version: { yonder: "0.3.0", commit: null },
	node: { id: "n1", name: "节点" },
	methods: over.methods ?? { "sessions.list": { scope: "read", since: 1 } },
	events: over.events ?? [],
	plugins: [],
	granted: ["read"],
	views: [],
	models: { select: false },
	remoteSession: { create: false, modes: [], agents: [], workspaces: false },
	features: {
		requestIdDedupe: true,
		resumableWatch: true,
		attachments: false,
		notifications: false,
		approvals: false,
		suggestions: false,
	},
	limits: { maxSubs: 64, attachmentMaxBytes: 0, transcriptPage: 50 },
	auth: { kind: over.kind ?? "local", owner: true },
});

beforeEach(() => {
	rpc.mockReset();
	vi.stubGlobal("document", { baseURI: "http://localhost:7690/" });
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => undefined,
		removeItem: () => undefined,
	});
});

/** 在 linkedom 里挂一个最小组件，读取 hook 的返回值。 */
async function renderHook<T>(use: () => T) {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const seen: T[] = [];
	function Probe() {
		seen.push(use());
		return null;
	}
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
	return {
		latest: () => seen[seen.length - 1] as T,
		unmount: async () => {
			await act(async () => root.unmount());
			client.clear();
		},
	};
}

describe("useCapabilities / useHasMethod", () => {
	it("拉取当前节点的 capabilities.get，并从方法表判断方法是否存在", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts();
			throw new Error(`Unexpected ${method}`);
		});
		const { useCapabilities, useHasMethod } = await import("../../src/work/api/capabilities");
		const caps = await renderHook(() => useCapabilities());
		await vi.waitFor(() => expect(caps.latest().data?.node.id).toBe("n1"));
		expect(rpc).toHaveBeenCalledWith("capabilities.get", {}, undefined, undefined);
		await caps.unmount();

		const has = await renderHook(() => useHasMethod("sessions.list"));
		await vi.waitFor(() => expect(has.latest()).toBe(true));
		await has.unmount();

		const missing = await renderHook(() => useHasMethod("update.status"));
		await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
		expect(missing.latest()).toBe(false);
		await missing.unmount();
	});

	it("远程节点带自己的 origin 取事实", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts({ kind: "remote" });
			throw new Error(`Unexpected ${method}`);
		});
		const { useCapabilities } = await import("../../src/work/api/capabilities");
		const node = { id: "cloud-1", name: "云", origin: "https://cloud.example" };
		const caps = await renderHook(() => useCapabilities(node));
		await vi.waitFor(() => expect(caps.latest().data?.kind).toBe("remote"));
		expect(rpc).toHaveBeenCalledWith("capabilities.get", {}, undefined, node);
		await caps.unmount();
	});
});

describe("useFeature", () => {
	it("节点缺少所需方法时不可见，并点出方法名", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts({ methods: {} });
			throw new Error(`Unexpected ${method}`);
		});
		const { useFeature } = await import("../../src/work/api/capabilities");
		const view = await renderHook(() => useFeature("work", { shell: "web" }));
		// 事实回来前先按「未登录」隐藏，回来后给出真正缺的方法。
		await vi.waitFor(() => expect(view.latest().reason).toContain("sessions.list"));
		expect(view.latest().visible).toBe(false);
		expect(view.latest().state).toBe("hide");
		await view.unmount();
	});

	it("方法齐备、壳与登录态满足时可见", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts();
			throw new Error(`Unexpected ${method}`);
		});
		const { useFeature } = await import("../../src/work/api/capabilities");
		const work = await renderHook(() => useFeature("work", { shell: "web" }));
		await vi.waitFor(() => expect(work.latest().visible).toBe(true));
		expect(work.latest().reason).toBeUndefined();
		await work.unmount();
	});

	it("顶栏只跟壳走：desktop 可见、web 与 mobile 不可见", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts();
			throw new Error(`Unexpected ${method}`);
		});
		const { useFeature } = await import("../../src/work/api/capabilities");
		const desktop = await renderHook(() => useFeature("topbar", { shell: "desktop" }));
		expect(desktop.latest().visible).toBe(true);
		await desktop.unmount();
		const web = await renderHook(() => useFeature("topbar", { shell: "web" }));
		expect(web.latest().visible).toBe(false);
		await web.unmount();
		const mobile = await renderHook(() => useFeature("topbar", { shell: "mobile" }));
		expect(mobile.latest().visible).toBe(false);
		await mobile.unmount();
	});

	it("社交功能按传入的登录态判定，与节点事实无关", async () => {
		rpc.mockImplementation(() => new Promise(() => undefined));
		const { useFeature } = await import("../../src/work/api/capabilities");
		const guest = await renderHook(() => useFeature("contacts", { shell: "web" }));
		expect(guest.latest().state).toBe("disabled");
		await guest.unmount();
		const authed = await renderHook(() => useFeature("contacts", { shell: "web", socialAuthed: true }));
		expect(authed.latest().visible).toBe(true);
		await authed.unmount();
	});
});
