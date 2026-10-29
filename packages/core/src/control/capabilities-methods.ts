import { hostname } from "node:os";
import { EVENT_TYPES } from "@yonder/protocol/gateway";
import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import { PROTOCOL } from "./method-types.js";
import { registry } from "./methods.js";
import { visibleViews } from "./views-methods.js";

/** contracts §12：NodeFacts 增补版本，v1.1 为 1；protocol 仍为 1。 */
export const NODE_FACTS_MINOR = 1;

/**
 * 节点身份：`yonder.yaml` 没有节点 id/name 配置键，`<home>/.yonder/device-id` 也只在 OAuth 登录后才生成，
 * 所以 id 与 name 都取本机 hostname（与 spec 16 的设备名同源），不生成随机值、不新增配置键。
 * 这是 contracts §12 未写明的来源，已记给维护者；两台机器同名时客户端会按 id 判重。
 */
const nodeIdentity = () => {
	const name = hostname();
	return { id: name, name };
};

export const capabilitiesMethods: MethodDef[] = [
	define({
		name: "capabilities.get",
		scope: "read",
		params: noParams,
		since: 1,
		async handler(_params, ctx) {
			const info = await ctx.releaseInfo();
			const plugins = (await ctx.kernel.management({ action: "plugins.list" } as never)) as Array<{
				id: string;
				version?: string;
				contributes?: { views?: string[] };
			}>;
			// methods 已按本次连接的 scope 与本地传输过滤，后面的能力开关全部从这张表判断（contracts §12：事实，不猜）。
			const methods = registry.facts(ctx.principal);
			const createSession = "sessions.open" in methods;
			return {
				protocol: PROTOCOL,
				minor: NODE_FACTS_MINOR,
				kind: ctx.principal.kind,
				version: { yonder: info.version, commit: info.origin?.commit ?? null },
				node: nodeIdentity(),
				methods,
				events: EVENT_TYPES,
				// plugins[].views 取插件清单 contributes.views；没有声明的插件给空数组。
				plugins: plugins.map((plugin) => ({
					id: plugin.id,
					version: plugin.version ?? "",
					views: plugin.contributes?.views ?? [],
				})),
				granted: ctx.principal.scopes,
				// 与 views.list 无参结果同源：同一个可见性过滤，免客户端再取一次。
				views: await visibleViews(ctx, {}),
				models: { select: "models.list" in methods && "sessions.model.set" in methods },
				remoteSession: {
					create: createSession,
					// sessions.open 目前只创建 task 会话；远程连接按 contracts §14.3 也只有 task。
					modes: createSession ? ["task"] : [],
					// agents.list 尚未注册，sessions.open 也不接受 agent 参数，当前没有可指定的 agent id。
					agents: [],
					workspaces: "workspaces.list" in methods,
				},
				limits: { maxSubs: 64, attachmentMaxBytes: 0, transcriptPage: 50 },
				features: {
					requestIdDedupe: true,
					resumableWatch: true,
					// attachments.put 是网关路由，不在控制注册表里；不可用时额度为 0（contracts §12）。
					attachments: "attachments.put" in methods,
					notifications: "notifications.prefs.get" in methods && "notifications.prefs.set" in methods,
					approvals: "approvals.list" in methods,
					suggestions: "suggestions.list" in methods,
				},
				auth: { kind: ctx.principal.kind, owner: ctx.principal.scopes.includes("owner") },
			};
		},
	}),
];
