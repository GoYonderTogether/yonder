import { describe, expect, it, vi } from "vitest";
import { LOCAL_NODE } from "../src/work/api/nodes";
import type { NodeFacts } from "../src/work/api/types";
import type { UpdateView } from "../src/work/api/update";
import {
	aboutRows,
	accountRows,
	gatewayRows,
	nodeRows,
	notifyRows,
	parseNodeOrigin,
	updateSummary,
	versionText,
} from "../src/work/features/settings/rows";

const facts = (over: Partial<NodeFacts> = {}): NodeFacts => ({
	protocol: 1,
	minor: 1,
	kind: "local",
	version: { yonder: "0.3.26102802", commit: "abcdef1234567890" },
	node: { id: "n1", name: "书房" },
	methods: { "sessions.list": { scope: "read", since: 1 } },
	events: [],
	plugins: [],
	granted: ["read", "write"],
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
	auth: { kind: "local", owner: true },
	...over,
});

const view = (over: Partial<UpdateView> = {}): UpdateView => ({
	facts: undefined,
	state: undefined,
	available: false,
	reason: undefined,
	...over,
});

describe("版本与网关行", () => {
	it("版本串带短 commit", () => {
		expect(versionText(facts())).toBe("0.3.26102802 (abcdef1)");
		expect(versionText(facts({ version: { yonder: "0.3.0", commit: null } }))).toBe("0.3.0");
	});

	it("网关事实没回来时没有行", () => {
		expect(gatewayRows(undefined)).toEqual([]);
	});

	it("本机与远程的连接方式不同", () => {
		const local = gatewayRows(facts());
		expect(local.find((row) => row.key === "kind")?.value).toBe("本机");
		expect(local.find((row) => row.key === "node")?.value).toBe("书房");
		expect(local.find((row) => row.key === "methods")?.value).toBe("1 个");
		expect(local.find((row) => row.key === "granted")?.value).toBe("read / write");
		expect(gatewayRows(facts({ kind: "remote" })).find((row) => row.key === "kind")?.value).toBe("远程");
	});
});

describe("账号分区", () => {
	it("社交账号未登录时显示未登录，登录后显示名字", () => {
		expect(accountRows(undefined, undefined).at(-1)).toEqual({ key: "social", label: "社交账号", value: "未登录" });
		expect(accountRows(facts(), "阿蓝").at(-1)?.value).toBe("阿蓝");
		expect(accountRows(undefined, "阿蓝")).toEqual([{ key: "social", label: "社交账号", value: "阿蓝" }]);
	});
});

describe("通知分区", () => {
	it("把全局偏好映射成开/关", () => {
		expect(notifyRows({ enabled: true, vibrate: false, previews: true })).toEqual([
			{ key: "enabled", label: "通知", value: "开" },
			{ key: "vibrate", label: "震动", value: "关" },
			{ key: "previews", label: "消息预览", value: "开" },
		]);
	});
});

describe("节点分区", () => {
	it("本机显示为同源且不可删除，远程节点可删除", () => {
		const rows = nodeRows(
			[LOCAL_NODE, { id: "cloud-1", name: "云服务器", origin: "https://cloud.example" }],
			"cloud-1",
		);
		expect(rows).toEqual([
			{ id: "local", name: "本机", origin: "同源（当前页面）", current: false, removable: false },
			{ id: "cloud-1", name: "云服务器", origin: "https://cloud.example", current: true, removable: true },
		]);
	});

	it("空名字退回 id", () => {
		expect(nodeRows([{ id: "x", name: "" }], "local")[0]?.name).toBe("x");
	});
});

describe("更新分区", () => {
	it("后端没有更新方法时说明不可用且没有按钮", () => {
		expect(updateSummary(view({ reason: "当前网关没有提供更新方法" }))).toEqual({
			text: "当前网关没有提供更新方法",
			action: "none",
		});
	});

	it("远程节点不操作本机更新", () => {
		const summary = updateSummary(view({ reason: "远程节点不能操作本机更新" }));
		expect(summary.action).toBe("none");
		expect(summary.text).toContain("远程");
	});

	it("只有 ready 才给应用按钮", () => {
		const ready = updateSummary(
			view({ available: true, state: { state: "ready", current: "0.3.0", latest: "0.3.1" } }),
		);
		expect(ready).toEqual({ text: "已下载 0.3.1，点击应用", action: "apply", actionLabel: "应用更新" });
		for (const state of ["checking", "downloading", "applying"] as const) {
			expect(updateSummary(view({ available: true, state: { state, current: "0.3.0" } })).action).toBe("none");
		}
	});

	it("idle 时给检查并下载；有新版才说可更新", () => {
		expect(updateSummary(view({ available: true, state: { state: "idle", current: "0.3.0" } }))).toEqual({
			text: "已是最新版本",
			action: "download",
			actionLabel: "检查并下载",
		});
		expect(
			updateSummary(view({ available: true, state: { state: "idle", current: "0.3.0", latest: "0.3.1" } })).text,
		).toBe("可更新到 0.3.1");
	});

	it("failed 显示错误并可重试", () => {
		expect(
			updateSummary(view({ available: true, state: { state: "failed", current: "0.3.0", error: "SHA 不符" } })),
		).toEqual({ text: "更新失败：SHA 不符", action: "download", actionLabel: "重试" });
	});

	it("关于分区带版本与更新状态", () => {
		const rows = aboutRows(view({ facts: facts() }));
		expect(rows.find((row) => row.key === "version")?.value).toBe("0.3.26102802 (abcdef1)");
		expect(rows.find((row) => row.key === "update")?.value).toBe("正在读取节点信息…");
		expect(aboutRows(view())).toEqual([{ key: "update", label: "更新", value: "正在读取节点信息…" }]);
	});
});

describe("添加节点表单", () => {
	it("空地址给提示", () => {
		expect(parseNodeOrigin("  ")).toEqual({ error: "填写节点地址" });
	});

	it("非法地址给错误文案", () => {
		expect(parseNodeOrigin("ftp://x").error).toContain("http");
	});

	it("合法地址规范化", () => {
		expect(parseNodeOrigin("https://cloud.example:7690/console/")).toEqual({
			origin: "https://cloud.example:7690/console",
		});
	});
});

describe("Settings 组件", () => {
	it("渲染账号、通知、节点、关于与退出", async () => {
		const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
		const { parseHTML } = await import("linkedom");
		const { act, createElement } = await import("react");
		const { createRoot } = await import("react-dom/client");
		const { Settings } = await import("../src/work/features/Settings");
		const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
		vi.stubGlobal("window", window);
		vi.stubGlobal("document", window.document);
		vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
		vi.stubGlobal("localStorage", {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined,
		});
		const factsData = facts();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				status: 200,
				ok: true,
				json: async () => ({ ok: true, result: factsData }),
				text: async () => JSON.stringify({ actor: { id: "a1", name: "阿蓝", kind: "human" } }),
			})),
		);
		const container = window.document.getElementById("root") as unknown as HTMLElement;
		const root = createRoot(container);
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const logout = vi.fn();
		try {
			await act(async () =>
				root.render(createElement(QueryClientProvider, { client }, createElement(Settings, { onLogout: logout }))),
			);
			await vi.waitFor(() => expect(container.textContent).toContain("已登录"));
			expect(container.querySelector('[data-testid="settings-account"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="settings-notify"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="settings-nodes"]')).not.toBeNull();
			expect(container.querySelector('[data-testid="settings-about"]')).not.toBeNull();
			await vi.waitFor(() => expect(container.textContent).toContain("阿蓝"));
			const button = [...container.querySelectorAll("button")].find((el) => el.textContent?.includes("退出登录"));
			expect(button).not.toBeUndefined();
			await act(async () => button?.dispatchEvent(new window.Event("click", { bubbles: true })));
			expect(logout).toHaveBeenCalledTimes(1);
		} finally {
			await act(async () => root.unmount());
			client.clear();
			vi.unstubAllGlobals();
		}
	});
});

it("云设备设置与工作列表使用统一设备授权入口", async () => {
	const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
	const { parseHTML } = await import("linkedom");
	const { act, createElement } = await import("react");
	const { createRoot } = await import("react-dom/client");
	const { MemoryRouter } = await import("react-router");
	const { Settings } = await import("../src/work/features/Settings");
	const { WorkList } = await import("../src/work/ui/WorkList");
	const { setCloudDevice, setActiveNode } = await import("../src/work/api/nodes");
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			status: 200,
			ok: true,
			json: async () => ({ ok: true, result: [] }),
			text: async () => JSON.stringify({ actor: { id: "a1", name: "阿蓝", kind: "human" } }),
		})),
	);
	setCloudDevice("a1", { id: "device-1", name: "我的设备" });
	const root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	try {
		await act(async () =>
			root.render(
				createElement(
					QueryClientProvider,
					{ client },
					createElement(MemoryRouter, null, createElement(Settings, { onLogout: () => {} }), createElement(WorkList)),
				),
			),
		);
		const body = window.document.body;
		expect(body.textContent).toContain("已登录 · 设备账号授权");
		expect(body.textContent).toContain("我的设备");
		expect(body.querySelector('[data-testid="settings-nodes"]')).toBeNull();
		expect(body.querySelector('[data-testid="console-entry"]')).toBeNull();
		expect(body.querySelector('[data-testid="current-device"]')).not.toBeNull();
		expect(body.textContent).not.toContain("远程访问令牌");
	} finally {
		await act(async () => root.unmount());
		setActiveNode("local");
		client.clear();
		vi.unstubAllGlobals();
	}
});
