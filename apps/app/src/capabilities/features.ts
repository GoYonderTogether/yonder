import type { NodeFacts } from "../api/types";
import { APP_MIN_PROTOCOL, nodeCapabilityFacts, type Shell, shellLabel } from "./facts";

/**
 * 功能可见性表（design.md 1.3 / 4.7，contracts §4、§12）。
 *
 * 只回答「这个功能现在该不该出现」，不管授权：网关仍按 scope 校验，隐藏不是权限。
 * 判定顺序：先客户端事实（壳、登录态），再节点事实，节点事实严格按 contracts §12
 * protocol → methods → features → events，禁止按插件名判断。
 */

export type FeatureId =
	| "topbar"
	| "work"
	| "bots"
	| "contacts"
	| "cards"
	| "dm"
	| "nodes"
	| "update"
	| "views"
	| "footer"
	| "notify";

/** 缺失条件时的表现：直接隐藏、显示为不可用并给出原因、或提示登录。 */
export type MissingPolicy = "hide" | "disabled" | "prompt-login";

export interface FeatureDef {
	id: FeatureId;
	/** 界面名称，供原因文案与调试使用。 */
	title: string;
	needs: {
		/** 只在列出的客户端壳里出现；不写表示三种壳都出现。 */
		shells?: readonly Shell[];
		/** 需要网关登录。 */
		gateway?: boolean;
		/** account=正式社交账号；session=有社交会话即可（访客也算）。 */
		social?: "account" | "session";
		/** 节点类型限制；不写表示本机与远程都可用。 */
		nodes?: readonly ("local" | "remote")[];
		/** 节点必须提供的方法（NodeFacts.methods 已按 scope 过滤）。 */
		methods?: readonly string[];
		/** 节点必须启用的能力开关（NodeFacts.features）。 */
		features?: readonly string[];
		/** 节点必须会发的事件（NodeFacts.events）。 */
		events?: readonly string[];
	};
	whenMissing: MissingPolicy;
}

export const FEATURES = {
	topbar: {
		id: "topbar",
		title: "顶栏",
		needs: { shells: ["desktop"] },
		whenMissing: "hide",
	},
	work: {
		id: "work",
		title: "工作",
		needs: { gateway: true, methods: ["sessions.list"] },
		whenMissing: "hide",
	},
	bots: {
		id: "bots",
		title: "常驻 Bot",
		needs: { gateway: true, methods: ["bots.list"] },
		whenMissing: "hide",
	},
	contacts: {
		id: "contacts",
		title: "通讯录",
		needs: { social: "session" },
		whenMissing: "prompt-login",
	},
	cards: {
		id: "cards",
		title: "名片",
		needs: { social: "account" },
		whenMissing: "prompt-login",
	},
	dm: {
		id: "dm",
		title: "私信",
		needs: { social: "session" },
		whenMissing: "prompt-login",
	},
	nodes: {
		id: "nodes",
		title: "节点",
		needs: { gateway: true, methods: ["capabilities.get"] },
		whenMissing: "hide",
	},
	update: {
		id: "update",
		title: "更新",
		needs: { gateway: true, nodes: ["local"], methods: ["update.status"] },
		whenMissing: "disabled",
	},
	views: {
		id: "views",
		title: "右栏卡片",
		needs: { gateway: true, methods: ["views.list"] },
		whenMissing: "hide",
	},
	footer: {
		id: "footer",
		title: "底栏用量",
		needs: { gateway: true, events: ["usage.updated"] },
		whenMissing: "hide",
	},
	notify: {
		id: "notify",
		title: "系统通知",
		needs: { shells: ["desktop"], events: ["notification"] },
		whenMissing: "hide",
	},
} as const satisfies Record<FeatureId, FeatureDef>;

/** 表里所有功能 id，按声明顺序。 */
export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export interface FeatureContext {
	/** 客户端壳，只来自注入的 window.__YONDER_SHELL__。 */
	shell: Shell;
	/** 网关登录成功（capabilities.get 拿到了事实）。 */
	gatewayAuthed: boolean;
	/** 正式社交账号已登录。 */
	socialAuthed: boolean;
	/** 只有访客社交会话（未注册）；与 socialAuthed 同时为真时按正式账号。 */
	socialAnonymous: boolean;
	/** NodeFacts.kind；事实还没回来时 undefined。 */
	nodeKind: "local" | "remote" | undefined;
	/** NodeFacts.granted：本次连接被授予的 scope。功能表按 methods 判定（methods 已按 scope 过滤），不重复用它做门槛。 */
	granted: readonly string[];
	/** NodeFacts.methods：本次连接可用的方法。 */
	methods: Readonly<Record<string, unknown>>;
	/** NodeFacts.protocol；事实还没回来时 undefined。 */
	protocol: number | undefined;
	/** NodeFacts.features：节点能力开关，是事实不是 UI 决定。 */
	features: Readonly<Record<string, boolean | undefined>>;
	/** NodeFacts.events：节点会发的事件 type。 */
	events: readonly string[];
}

export interface FeatureContextInput {
	shell?: Shell;
	gatewayAuthed: boolean;
	socialAuthed?: boolean;
	socialAnonymous?: boolean;
	/** capabilities.get 的结果；还没拿到时不传。 */
	facts?: Partial<NodeFacts> | null;
}

/** 从客户端事实与节点事实组装判定上下文；缺失字段按「没有」处理，不猜。 */
export function featureContext(input: FeatureContextInput): FeatureContext {
	return {
		shell: input.shell ?? "web",
		gatewayAuthed: input.gatewayAuthed,
		socialAuthed: input.socialAuthed ?? false,
		socialAnonymous: !input.socialAuthed && (input.socialAnonymous ?? false),
		...nodeCapabilityFacts(input.facts),
	};
}

export type FeatureState = "show" | "hide" | "disabled";

export interface FeatureVisibility {
	state: FeatureState;
	/** 不可见或不可用时的原因；state=show 时没有。 */
	reason?: string;
	/** 未满足的处置方式（prompt-login 时界面要给登录入口）；state=show 时没有。 */
	missing?: MissingPolicy;
}

const SHOW: FeatureVisibility = { state: "show" };

/**
 * 缺条件时按表里的 whenMissing 决定表现，原因照实写。
 * prompt-login 按 design.md 1.3 映射为 disabled：功能不可用，但界面要给出登录入口。
 */
function miss(def: Pick<FeatureDef, "whenMissing">, reason: string): FeatureVisibility {
	if (def.whenMissing === "hide") return { state: "hide", reason, missing: "hide" };
	return { state: "disabled", reason, missing: def.whenMissing };
}

const usesNode = (needs: FeatureDef["needs"]): boolean =>
	needs.nodes !== undefined ||
	needs.methods !== undefined ||
	needs.features !== undefined ||
	needs.events !== undefined;

/**
 * 按一张功能定义判定可见性。先客户端事实，再节点事实；
 * 节点事实严格按 contracts §12：protocol → methods → features → events。
 */
export function evaluateFeature(def: FeatureDef, ctx: FeatureContext): FeatureVisibility {
	const needs = def.needs;

	// 客户端事实：壳。
	if (needs.shells && !needs.shells.includes(ctx.shell))
		return miss(def, `只在${needs.shells.map(shellLabel).join("、")}里显示`);

	// 客户端事实：登录态。访客社交会话算「有社交会话」。
	if (needs.gateway && !ctx.gatewayAuthed) return miss(def, "登录网关后可用");
	if (needs.social === "account" && !ctx.socialAuthed) return miss(def, "注册社交账号后可用");
	if (needs.social === "session" && !ctx.socialAuthed && !ctx.socialAnonymous) return miss(def, "登录社交账号后可用");

	if (!usesNode(needs)) return SHOW;

	// 节点事实：事实没回来时不下结论，先隐藏。
	if (ctx.protocol === undefined) return { state: "hide" };

	// 1. protocol
	if (ctx.protocol < APP_MIN_PROTOCOL) return { state: "disabled", reason: "节点版本较旧，请更新" };

	// 节点类型是本机/远程的硬边界，先于方法表。
	if (needs.nodes && (!ctx.nodeKind || !needs.nodes.includes(ctx.nodeKind)))
		return miss(def, needs.nodes.includes("local") ? "仅本机节点可用" : "仅远程节点可用");

	// 2. methods
	if (needs.methods) {
		const absent = needs.methods.filter((name) => !(name in ctx.methods));
		if (absent.length) return miss(def, `节点没有向这个连接提供 ${absent.join("、")} 方法`);
	}

	// 3. features
	if (needs.features) {
		const off = needs.features.filter((name) => ctx.features[name] !== true);
		if (off.length) return miss(def, `节点没有启用 ${off.join("、")} 能力`);
	}

	// 4. events
	if (needs.events) {
		const silent = needs.events.filter((name) => !ctx.events.includes(name));
		if (silent.length) return miss(def, `节点不会推送 ${silent.join("、")} 事件`);
	}
	return SHOW;
}

/** 功能现在是否可见。纯函数：输入全部来自参数，不读 window、不发请求。 */
export function featureVisible(feature: FeatureId, ctx: FeatureContext): FeatureVisibility {
	const def = (FEATURES as Record<string, FeatureDef | undefined>)[feature];
	if (!def) return { state: "hide", reason: `未知功能 ${String(feature)}` };
	return evaluateFeature(def, ctx);
}
