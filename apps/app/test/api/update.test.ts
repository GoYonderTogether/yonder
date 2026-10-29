import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../src/work/api/client", () => ({ rpc }));

const facts = (over: { kind?: "local" | "remote"; methods?: Record<string, unknown> } = {}) => ({
	protocol: 1,
	minor: 1,
	kind: over.kind ?? "local",
	version: { yonder: "0.3.0", commit: null },
	node: { id: "n1", name: "节点" },
	methods: over.methods ?? {
		"update.status": { scope: "read", local: true, since: 1 },
		"update.download": { scope: "admin", local: true, since: 1 },
		"update.apply": { scope: "admin", local: true, since: 1 },
	},
	events: [],
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

describe("useUpdateState", () => {
	it("本机节点且方法已注册时查询 update.status", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts();
			if (method === "update.status") return { state: "ready", current: "0.3.0", latest: "0.3.1", progress: 1 };
			throw new Error(`Unexpected ${method}`);
		});
		const { useUpdateState } = await import("../../src/work/api/update");
		const view = await renderHook(() => useUpdateState());
		await vi.waitFor(() => expect(view.latest().state?.state).toBe("ready"));
		expect(view.latest().available).toBe(true);
		expect(view.latest().facts?.version.yonder).toBe("0.3.0");
		expect(rpc).toHaveBeenCalledWith("update.status", {}, undefined, undefined);
		await view.unmount();
	});

	it("后端没有 update.status 时返回明确不可用，不查询也不伪造 ready", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts({ methods: {} });
			throw new Error(`Unexpected ${method}`);
		});
		const { useUpdateState } = await import("../../src/work/api/update");
		const view = await renderHook(() => useUpdateState());
		await vi.waitFor(() => expect(view.latest().reason).toBeDefined());
		expect(view.latest().available).toBe(false);
		expect(view.latest().state).toBeUndefined();
		expect(view.latest().reason).toContain("没有提供更新方法");
		expect(rpc).not.toHaveBeenCalledWith("update.status", expect.anything(), expect.anything(), expect.anything());
		await view.unmount();
	});

	it("远程节点不操作本机更新", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts({ kind: "remote" });
			throw new Error(`Unexpected ${method}`);
		});
		const { useUpdateState } = await import("../../src/work/api/update");
		const view = await renderHook(() => useUpdateState());
		await vi.waitFor(() => expect(view.latest().reason).toBeDefined());
		expect(view.latest().available).toBe(false);
		expect(view.latest().reason).toContain("远程");
		await view.unmount();
	});

	it("节点事实还没回来时既不可用也不报错", async () => {
		rpc.mockImplementation(() => new Promise(() => undefined));
		const { useUpdateState } = await import("../../src/work/api/update");
		const view = await renderHook(() => useUpdateState());
		expect(view.latest().available).toBe(false);
		expect(view.latest().state).toBeUndefined();
		expect(view.latest().reason).toBeUndefined();
		await view.unmount();
	});

	it("远程节点完全不发请求，也不把更新方法带出来", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "capabilities.get") return facts({ kind: "remote" });
			throw new Error(`Unexpected ${method}`);
		});
		const { useUpdateState } = await import("../../src/work/api/update");
		const node = { id: "cloud-1", name: "云", origin: "https://cloud.example" };
		const view = await renderHook(() => useUpdateState(node));
		expect(view.latest().available).toBe(false);
		expect(view.latest().reason).toContain("远程节点");
		expect(rpc).not.toHaveBeenCalled();
		await view.unmount();
	});
});

describe("下载与应用", () => {
	it("download 返回 ready，apply 只在点击后调用", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "update.download") return { state: "ready", current: "0.3.0", latest: "0.3.1" };
			if (method === "update.apply") return { ok: true };
			throw new Error(`Unexpected ${method}`);
		});
		const { useDownloadUpdate, useApplyUpdate } = await import("../../src/work/api/update");
		const download = await renderHook(() => useDownloadUpdate());
		await act(async () => {
			await download.latest().mutateAsync();
		});
		expect(rpc).toHaveBeenCalledWith("update.download", {}, undefined, undefined);
		expect(rpc).not.toHaveBeenCalledWith("update.apply", expect.anything(), expect.anything(), expect.anything());
		await download.unmount();

		const apply = await renderHook(() => useApplyUpdate());
		let result: { ok: boolean; hint?: string } | undefined;
		await act(async () => {
			result = await apply.latest().mutateAsync();
		});
		expect(result).toEqual({ ok: true });
		await apply.unmount();
	});

	it("apply 返回包管理器提示时原样带出", async () => {
		rpc.mockImplementation(async (method: string) => {
			if (method === "update.apply") return { ok: false, hint: "brew upgrade yonder" };
			throw new Error(`Unexpected ${method}`);
		});
		const { useApplyUpdate } = await import("../../src/work/api/update");
		const apply = await renderHook(() => useApplyUpdate());
		let result: { ok: boolean; hint?: string } | undefined;
		await act(async () => {
			result = await apply.latest().mutateAsync();
		});
		expect(result).toEqual({ ok: false, hint: "brew upgrade yonder" });
		await apply.unmount();
	});
});
