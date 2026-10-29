import { describe, expect, it } from "vitest";
import type { NodeFacts } from "../src/api/types";
import { clientFacts, nodeCapabilityFacts, readShell, shellOf } from "../src/capabilities/facts";
import {
	FEATURE_IDS,
	FEATURES,
	type FeatureContext,
	type FeatureId,
	featureContext,
	featureVisible,
} from "../src/capabilities/features";

/** 一份完整的 NodeFacts，按 contracts §4/§12 的形状；局部覆盖只改需要的字段。 */
function facts(over: Partial<NodeFacts> = {}): NodeFacts {
	return {
		protocol: 1,
		minor: 1,
		kind: "local",
		version: { yonder: "0.3.0", commit: null },
		node: { id: "n1", name: "书房" },
		methods: {
			"capabilities.get": { scope: "read", since: 1 },
			"sessions.list": { scope: "read", since: 1 },
			"sessions.watch": { scope: "read", stream: true, since: 1 },
			"bots.list": { scope: "owner", since: 1 },
			"views.list": { scope: "read", since: 1 },
			"update.status": { scope: "read", local: true, since: 1 },
		},
		events: [
			"usage.updated",
			"context.updated",
			"notification",
			"suggestion.created",
			"approval.requested",
			"approval.answered",
		],
		plugins: [{ id: "social", version: "1.0.0", views: [] }],
		granted: ["read", "write", "admin", "owner"],
		views: [],
		models: { select: false },
		remoteSession: { create: false, modes: [], agents: [], workspaces: false },
		features: {
			requestIdDedupe: true,
			resumableWatch: true,
			attachments: true,
			notifications: true,
			approvals: true,
			suggestions: true,
		},
		limits: { maxSubs: 64, attachmentMaxBytes: 0, transcriptPage: 50 },
		auth: { kind: "local", owner: true },
		...over,
	};
}

const ctx = (over: Partial<FeatureContext> = {}): FeatureContext => ({
	shell: "web",
	gatewayAuthed: true,
	socialAuthed: true,
	socialAnonymous: false,
	nodeKind: "local",
	granted: ["read", "write", "admin", "owner"],
	methods: facts().methods,
	protocol: 1,
	features: facts().features,
	events: facts().events,
	...over,
});

const state = (feature: FeatureId, over: Partial<FeatureContext> = {}) => featureVisible(feature, ctx(over)).state;

describe("壳只认注入的字符串", () => {
	it("desktop / mobile 生效，其余一律按 web", () => {
		expect(shellOf("desktop")).toBe("desktop");
		expect(shellOf("mobile")).toBe("mobile");
		expect(shellOf(undefined)).toBe("web");
		expect(shellOf("web")).toBe("web");
		// 旧版注入形状与未知值都不猜。
		expect(shellOf(true)).toBe("web");
		expect(shellOf({ platform: "mac" })).toBe("web");
		expect(shellOf("Desktop")).toBe("web");
		expect(shellOf("")).toBe("web");
	});

	it("readShell 只读 window.__YONDER_SHELL__，没有 window 时是 web", () => {
		expect(readShell({ __YONDER_SHELL__: "desktop" })).toBe("desktop");
		expect(readShell({ __YONDER_SHELL__: "mobile" })).toBe("mobile");
		expect(readShell({})).toBe("web");
		expect(readShell(undefined)).toBe("web");
	});

	it("平台外观本地检测，不影响壳", () => {
		expect(clientFacts({ __YONDER_SHELL__: "desktop" }, "MacIntel")).toEqual({
			shell: "desktop",
			platform: "MacIntel",
			mac: true,
		});
		expect(clientFacts({}, "Win32").mac).toBe(false);
		expect(clientFacts({ __YONDER_SHELL__: "desktop" }, "").shell).toBe("desktop");
	});
});

describe("顶栏只在桌面壳出现", () => {
	it.each([
		["web", "hide"],
		["desktop", "show"],
		["mobile", "hide"],
	] as const)("壳 %s → %s", (shell, expected) => {
		expect(state("topbar", { shell })).toBe(expected);
	});

	it("未登录网关也不影响顶栏判定（顶栏不依赖节点事实）", () => {
		expect(state("topbar", { shell: "desktop", gatewayAuthed: false })).toBe("show");
		expect(state("topbar", { shell: "web", gatewayAuthed: false })).toBe("hide");
	});

	it("隐藏时给出原因", () => {
		const result = featureVisible("topbar", ctx({ shell: "web" }));
		expect(result.state).toBe("hide");
		expect(result.reason).toContain("桌面壳");
	});
});

describe("社交功能按登录态显示（与节点无关）", () => {
	const shells = ["web", "desktop", "mobile"] as const;
	const socialStates = [
		["未登录", { socialAuthed: false, socialAnonymous: false }],
		["匿名访客", { socialAuthed: false, socialAnonymous: true }],
		["正式账号", { socialAuthed: true, socialAnonymous: false }],
	] as const;

	it.each(shells.flatMap((shell) => socialStates.map(([label, over]) => [shell, label, over] as const)))(
		"%s 壳 + %s",
		(shell, _label, over) => {
			const anonymous = over.socialAnonymous;
			const authed = over.socialAuthed;
			expect(state("contacts", { shell, ...over })).toBe(anonymous || authed ? "show" : "disabled");
			expect(state("dm", { shell, ...over })).toBe(anonymous || authed ? "show" : "disabled");
			// 名片只对正式账号开放；访客看到登录提示。
			expect(state("cards", { shell, ...over })).toBe(authed ? "show" : "disabled");
		},
	);

	it("未登录时给登录提示原因，不是静默消失", () => {
		const contacts = featureVisible("contacts", ctx({ socialAuthed: false, socialAnonymous: false }));
		expect(contacts.state).toBe("disabled");
		expect(contacts.missing).toBe("prompt-login");
		expect(contacts.reason).toContain("社交");
		const cards = featureVisible("cards", ctx({ socialAuthed: false, socialAnonymous: true }));
		expect(cards.state).toBe("disabled");
		expect(cards.missing).toBe("prompt-login");
		expect(cards.reason).toContain("注册");
	});

	it("社交功能与节点事实无关：节点事实缺失时仍按登录态判定", () => {
		const unauth = featureContext({ shell: "web", gatewayAuthed: false, socialAuthed: true });
		expect(featureVisible("contacts", unauth).state).toBe("show");
		expect(featureVisible("cards", unauth).state).toBe("show");
	});
});

describe("控制台功能按网关事实显示", () => {
	it.each(["web", "desktop", "mobile"] as const)("%s 壳未登录时隐藏工作与节点", (shell) => {
		expect(state("work", { shell, gatewayAuthed: false })).toBe("hide");
		expect(state("nodes", { shell, gatewayAuthed: false })).toBe("hide");
	});

	it.each(["web", "desktop", "mobile"] as const)("%s 壳已登录且本机有方法时显示", (shell) => {
		expect(state("work", { shell })).toBe("show");
		expect(state("nodes", { shell })).toBe("show");
	});

	it.each([
		["local", "show"],
		["remote", "disabled"],
	] as const)("更新只在 %s 节点可用（期望 %s）", (nodeKind, expected) => {
		expect(state("update", { nodeKind })).toBe(expected);
	});

	it("远程节点不能操作本机更新，原因写明只在本机", () => {
		const remote = featureVisible("update", ctx({ nodeKind: "remote" }));
		expect(remote.state).toBe("disabled");
		expect(remote.reason).toContain("本机");
	});

	it("本机节点没有 update.status 时不可用并点出方法名", () => {
		const result = featureVisible("update", ctx({ methods: { "capabilities.get": { scope: "read", since: 1 } } }));
		expect(result.state).toBe("disabled");
		expect(result.reason).toContain("update.status");
	});

	it("常驻 Bot 列表缺失 bots.list 时隐藏并点出方法名", () => {
		const result = featureVisible("bots", ctx({ methods: { "sessions.list": { scope: "read", since: 1 } } }));
		expect(result.state).toBe("hide");
		expect(result.reason).toContain("bots.list");
	});

	it("方法判断不看插件名：装了 social 插件但没有方法时仍隐藏", () => {
		const withPlugin = featureContext({
			gatewayAuthed: true,
			facts: facts({ methods: {}, plugins: [{ id: "social", version: "9", views: [] }] }),
		});
		expect(featureVisible("work", withPlugin)).toMatchObject({ state: "hide" });
		expect(featureVisible("work", withPlugin).reason).toContain("sessions.list");
	});
});

describe("节点事实判定顺序 protocol → methods → features → events", () => {
	it("协议版本低于应用要求时不可用，原因指向节点版本", () => {
		const old = featureContext({ gatewayAuthed: true, facts: facts({ protocol: 0 }) });
		expect(featureVisible("work", old)).toEqual({ state: "disabled", reason: "节点版本较旧，请更新" });
	});

	it("协议优先于方法：旧节点即使没有方法也只报版本原因", () => {
		const old = featureContext({ gatewayAuthed: true, facts: facts({ protocol: 0, methods: {} }) });
		const result = featureVisible("work", old);
		expect(result.reason).toBe("节点版本较旧，请更新");
	});

	it("方法优先于 features：缺方法时只报方法原因", () => {
		const noMethods = featureContext({
			gatewayAuthed: true,
			facts: facts({ methods: {}, features: { ...facts().features, suggestions: false } }),
		});
		const result = featureVisible("work", noMethods);
		expect(result.reason).toContain("sessions.list");
		expect(result.reason).not.toContain("能力");
	});

	it("方法齐备后检查 features：能力开关关闭时不可见", () => {
		const gate = featureVisible(
			"notify",
			featureContext({ shell: "desktop", gatewayAuthed: true, facts: facts({ events: [] }) }),
		);
		expect(gate.state).toBe("hide");
		expect(gate.reason).toContain("notification");
	});

	it("events 最后检查：方法齐备、事件缺失时隐藏并点出事件名", () => {
		const noEvents = featureContext({ gatewayAuthed: true, facts: facts({ events: [] }) });
		const footer = featureVisible("footer", noEvents);
		expect(footer.state).toBe("hide");
		expect(footer.reason).toContain("usage.updated");
	});

	it("节点事实还没回来时不下结论，也不给原因", () => {
		const pending = featureContext({ gatewayAuthed: true });
		expect(featureVisible("work", pending)).toEqual({ state: "hide" });
		expect(featureVisible("footer", pending)).toEqual({ state: "hide" });
	});

	it("nodeCapabilityFacts 对缺字段按没有处理，不伪造", () => {
		expect(nodeCapabilityFacts(undefined)).toEqual({
			protocol: undefined,
			nodeKind: undefined,
			granted: [],
			methods: {},
			features: {},
			events: [],
		});
		expect(nodeCapabilityFacts({ protocol: 1, kind: "weird" as never }).nodeKind).toBeUndefined();
	});
});

describe("功能表自洽", () => {
	it("每个功能 id 与定义一致，未知功能隐藏", () => {
		for (const id of FEATURE_IDS) expect(FEATURES[id].id).toBe(id);
		expect(featureVisible("nope" as FeatureId, ctx()).state).toBe("hide");
	});

	it("三种壳 × 登录态 × 本机/远程的完整组合都能给出确定结果", () => {
		for (const shell of ["web", "desktop", "mobile"] as const)
			for (const gatewayAuthed of [false, true])
				for (const social of [
					{ socialAuthed: false, socialAnonymous: false },
					{ socialAuthed: false, socialAnonymous: true },
					{ socialAuthed: true, socialAnonymous: false },
				])
					for (const nodeKind of ["local", "remote", undefined] as const)
						for (const id of FEATURE_IDS) {
							const result = featureVisible(id, ctx({ shell, gatewayAuthed, nodeKind, ...social }));
							expect(["show", "hide", "disabled"]).toContain(result.state);
							// show 不带原因；其余都给出原因，除非节点事实还没到。
							if (result.state === "show") expect(result.reason).toBeUndefined();
						}
	});

	it("同一次判定里，条件齐备的桌面本机节点让全部功能可见", () => {
		const all = ctx({ shell: "desktop" });
		expect(FEATURE_IDS.map((id) => [id, featureVisible(id, all).state])).toEqual(FEATURE_IDS.map((id) => [id, "show"]));
	});
});
