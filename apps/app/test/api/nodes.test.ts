import { beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		removeItem: (key: string) => void values.delete(key),
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal("localStorage", memoryStorage());
	vi.stubGlobal("document", { baseURI: "http://localhost:7690/" });
});

const facts = (node: { id: string; name: string }, protocol = 1) => ({
	protocol,
	minor: 1,
	kind: "local" as const,
	version: { yonder: "0.3.0", commit: null },
	node,
	methods: {},
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
	auth: { kind: "local" as const, owner: true },
});

function stubFetch(handler: (url: string, init: RequestInit) => unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: URL | string, init: RequestInit = {}) => {
			const url = String(input);
			calls.push({ url, init });
			return { status: 200, ok: true, json: async () => ({ ok: true, result: handler(url, init) }) };
		}),
	);
	return calls;
}

describe("节点存储", () => {
	it("账号设备 RPC 与流指向云桥，选择不跨账号保存", async () => {
		vi.stubGlobal("location", { href: "https://app.example/work", origin: "https://app.example" });
		const calls = stubFetch(() => ({}));
		const { setCloudDevice, activeNode } = await import("../../src/work/api/nodes");
		const { rpc, wsUrl } = await import("../../src/work/api/client");
		const { setWorkDevices } = await import("../../src/work/lib/workOnline");
		setWorkDevices([{ id: "device-a", online: false }]);
		await expect(rpc("sessions.list", {}, undefined, { deviceId: "device-a" })).rejects.toMatchObject({
			code: "device_offline",
		});
		expect(calls).toHaveLength(0);
		setWorkDevices([{ id: "device-a", online: true, workProtocol: 1 }]);
		setCloudDevice("account-a", { id: "device-a", name: "A" });
		await rpc("sessions.list");
		expect(calls[0]?.url).toBe("https://app.example/api/devices/device-a/work/rpc/sessions.list");
		expect(wsUrl()).toBe("wss://app.example/ws/work?device=device-a");
		expect(localStorage.getItem("yonder.nodes")).not.toContain("device-a");
		setCloudDevice("account-b", { id: "device-a", name: "A" });
		expect(activeNode().id).toBe("account:account-b:device:device-a");
	});

	it("默认只有本机节点，本机不可删除", async () => {
		const { nodeList, activeNode, removeNode, LOCAL_NODE } = await import("../../src/work/api/nodes");
		expect(nodeList()).toEqual([LOCAL_NODE]);
		expect(activeNode().id).toBe("local");
		removeNode(LOCAL_NODE.id);
		expect(nodeList()).toEqual([LOCAL_NODE]);
	});

	it("从 localStorage 的 yonder.nodes 读取，本机恒在首位", async () => {
		localStorage.setItem("yonder.nodes", JSON.stringify([{ id: "cloud-1", name: "云", origin: "https://c.example" }]));
		const { nodeList } = await import("../../src/work/api/nodes");
		expect(nodeList().map((node) => node.id)).toEqual(["local", "cloud-1"]);
	});

	it("旧令牌被丢弃，选中节点用于 RPC 和流", async () => {
		localStorage.setItem(
			"yonder.nodes",
			JSON.stringify([{ id: "cloud-1", name: "云", origin: "https://c.example/console", token: "old-secret" }]),
		);
		const calls = stubFetch(() => ({}));
		const { setActiveNode } = await import("../../src/work/api/nodes");
		const { rpc, wsUrl } = await import("../../src/work/api/client");
		setActiveNode("cloud-1");
		await rpc("sessions.list");
		expect(calls[0]?.url).toBe("https://c.example/console/api/rpc/sessions.list");
		expect(wsUrl()).toBe("wss://c.example/console/api/stream?v=1");
		expect(localStorage.getItem("yonder.nodes")).not.toContain("old-secret");
	});

	it("切换节点不会改变已经发出的提交目标", async () => {
		localStorage.setItem(
			"yonder.nodes",
			JSON.stringify([
				{ id: "a", name: "A", origin: "https://a.example" },
				{ id: "b", name: "B", origin: "https://b.example" },
			]),
		);
		let finish!: (value: unknown) => void;
		const calls: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn((url: URL) => {
				calls.push(String(url));
				return new Promise((resolve) => {
					finish = resolve;
				});
			}),
		);
		const { setActiveNode } = await import("../../src/work/api/nodes");
		const { rpc } = await import("../../src/work/api/client");
		setActiveNode("a");
		const submitted = rpc("sessions.submit", { id: "same", text: "test" });
		setActiveNode("b");
		finish({ status: 200, ok: true, json: async () => ({ ok: true, result: {} }) });
		await submitted;
		expect(calls).toEqual(["https://a.example/api/rpc/sessions.submit"]);
	});

	it("记录损坏时退回只有本机", async () => {
		localStorage.setItem("yonder.nodes", "{not json");
		const { nodeList } = await import("../../src/work/api/nodes");
		expect(nodeList().map((node) => node.id)).toEqual(["local"]);
	});

	it("切换当前节点", async () => {
		localStorage.setItem("yonder.nodes", JSON.stringify([{ id: "cloud-1", name: "云", origin: "https://c" }]));
		const { setActiveNode, activeNode } = await import("../../src/work/api/nodes");
		setActiveNode("cloud-1");
		expect(activeNode().id).toBe("cloud-1");
		// 不存在的 id 不改变选择
		setActiveNode("nope");
		expect(activeNode().id).toBe("cloud-1");
	});
});

describe("添加与删除节点", () => {
	it("添加节点先登录、再用 capabilities.get 读真实 node.id", async () => {
		const calls = stubFetch((url) => (url.endsWith("/login") ? {} : facts({ id: "cloud-1", name: "云服务器" })));
		const { addNode } = await import("../../src/work/api/nodes");
		const node = await addNode({ origin: "https://cloud.example:7690/console/", token: "t" });
		expect(node).toEqual({
			id: "cloud-1",
			name: "云服务器",
			origin: "https://cloud.example:7690/console",
		});
		expect(calls.map((call) => call.url)).toEqual([
			"https://cloud.example:7690/console/login",
			"https://cloud.example:7690/console/api/rpc/capabilities.get",
		]);
		expect(localStorage.getItem("yonder.nodes")).not.toContain('"token"');
		// 远程节点要带 cookie
		expect(calls[1]?.init.credentials).toBe("include");
	});

	it("重复 id 拒绝添加", async () => {
		stubFetch(() => facts({ id: "cloud-1", name: "云" }));
		const { addNode, nodeList } = await import("../../src/work/api/nodes");
		await addNode({ origin: "https://cloud.example" });
		await expect(addNode({ origin: "https://other.example" })).rejects.toThrow("已经添加过");
		expect(nodeList()).toHaveLength(2);
	});

	it("协议版本不一致拒绝添加", async () => {
		stubFetch(() => facts({ id: "cloud-2", name: "旧节点" }, 2));
		const { addNode, nodeList } = await import("../../src/work/api/nodes");
		await expect(addNode({ origin: "https://old.example" })).rejects.toThrow("协议版本");
		expect(nodeList()).toHaveLength(1);
	});

	it("节点没有 node.id 时拒绝", async () => {
		stubFetch(() => facts({ id: "", name: "" }));
		const { addNode } = await import("../../src/work/api/nodes");
		await expect(addNode({ origin: "https://x.example" })).rejects.toThrow("node.id");
	});

	it("规范化地址：拒绝非 http(s)，去掉结尾斜杠但保留挂载路径", async () => {
		const { normalizeOrigin } = await import("../../src/work/api/nodes");
		expect(() => normalizeOrigin("ftp://x")).toThrow();
		expect(() => normalizeOrigin("not a url")).toThrow();
		expect(normalizeOrigin("https://h:1/a/")).toBe("https://h:1/a");
		expect(normalizeOrigin("http://h:2")).toBe("http://h:2");
	});

	it("删除节点清理它的查询，不影响本机与其他节点", async () => {
		const { QueryClient } = await import("@tanstack/react-query");
		const { qk } = await import("../../src/work/api/keys");
		const client = new QueryClient();
		client.setQueryData(qk.sessions("local"), [{ id: "local-1" }]);
		client.setQueryData(qk.sessions("cloud-1"), [{ id: "cloud-1" }]);
		client.setQueryData(qk.session("s1", "cloud-1"), { id: "s1" });
		client.setQueryData(qk.sessions("cloud-2"), [{ id: "cloud-2" }]);

		stubFetch(() => facts({ id: "cloud-1", name: "云" }));
		const { addNode, removeNode } = await import("../../src/work/api/nodes");
		await addNode({ origin: "https://cloud.example" });
		removeNode("cloud-1", client);

		expect(client.getQueryData(qk.sessions("cloud-1"))).toBeUndefined();
		expect(client.getQueryData(qk.session("s1", "cloud-1"))).toBeUndefined();
		expect(client.getQueryData(qk.sessions("local"))).toEqual([{ id: "local-1" }]);
		expect(client.getQueryData(qk.sessions("cloud-2"))).toEqual([{ id: "cloud-2" }]);
	});

	it("删除当前节点时退回本机", async () => {
		localStorage.setItem("yonder.nodes", JSON.stringify([{ id: "cloud-1", name: "云", origin: "https://c.example" }]));
		const { setActiveNode, activeNode, removeNode } = await import("../../src/work/api/nodes");
		setActiveNode("cloud-1");
		removeNode("cloud-1");
		expect(activeNode().id).toBe("local");
	});
});

describe("多节点查询 key", () => {
	it("首段是节点 id，两节点缓存互不污染", async () => {
		const { qk } = await import("../../src/work/api/keys");
		expect(qk.sessions()).toEqual(["local", "sessions"]);
		expect(qk.sessions("cloud-1")).toEqual(["cloud-1", "sessions"]);
		expect(qk.capabilities("cloud-1")).toEqual(["cloud-1", "capabilities"]);
		expect(qk.update("cloud-1")).toEqual(["cloud-1", "update"]);
	});
});
