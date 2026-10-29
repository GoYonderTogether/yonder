import Type, { type TSchema } from "typebox";
import { socialDefaults, socialPolicySchema } from "../config/social-schema.js";
import { SocialError } from "../kernel/social.js";
import { type HostCtx, type MethodDef, MethodError } from "./method-types.js";

const text = Type.String({ minLength: 1 });
const mapping = Type.Object({ subject: text, agent: text, profile: text });
const patch = Type.Object(
	{ ...socialPolicySchema.properties, mappings: Type.Optional(Type.Array(mapping)) },
	{ additionalProperties: false },
);
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	return def as unknown as MethodDef;
}

async function call<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof SocialError) throw new MethodError(error.code, error.message, error.data);
		throw error;
	}
}

/** 该 agent 收到过群消息的会话，按最近活跃倒序；标签与模式取 social.inspect 的生效策略，无权限的会话略过。 */
async function listGroups(agent: string, ctx: HostCtx) {
	const groups = new Map<string, { title?: string | undefined; lastActiveAt: string }>();
	let after: string | undefined;
	for (let page = 0; page < 100; page++) {
		const result = await ctx.kernel.events.query({
			type: "message.in",
			agent,
			limit: 1000,
			...(after ? { after } : {}),
		});
		for (const event of result.events) {
			const data = event.data as { kind?: unknown; title?: unknown; groupName?: unknown };
			if (!event.conv || data.kind !== "group") continue;
			const title = [data.title, data.groupName].find((v): v is string => typeof v === "string" && v !== "");
			const known = groups.get(event.conv);
			groups.set(event.conv, {
				...((title ?? known?.title) ? { title: title ?? known?.title } : {}),
				lastActiveAt: event.ts,
			});
		}
		if (!result.next) break;
		after = result.next;
	}
	const rows = [];
	for (const [conv, group] of groups) {
		try {
			const { policy } = await ctx.kernel.social.inspect({ agent, conv }, ctx.principal);
			// SDK 的 SocialPolicy 尚无 tags 字段；会话策略里的 tags 按结构读取，缺省用 socialDefaults.tags。
			const tags = (policy as { tags?: { value?: string; rhythm?: string } }).tags;
			rows.push({ conv, ...group, mode: policy.mode ?? "batch", tags: { ...socialDefaults.tags, ...tags } });
		} catch (error) {
			if (!(error instanceof SocialError)) throw error;
		}
	}
	return rows.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export const socialMethods: MethodDef[] = [
	define({
		name: "social.groups",
		scope: "admin",
		since: 1,
		params: Type.Object({ agent: text }),
		handler: async (params, ctx) => listGroups(params.agent, ctx),
	}),
	define({
		name: "social.inspect",
		scope: "read",
		since: 1,
		params: Type.Object({ agent: text, conv: text, event: Type.Optional(text) }),
		handler: async (params, ctx) => call(() => ctx.kernel.social.inspect(params, ctx.principal)),
	}),
	define({
		name: "social.update",
		scope: "admin",
		since: 1,
		params: Type.Object({
			agent: text,
			conv: text,
			expectedRevision: text,
			patch,
			reason: text,
			dryRun: Type.Optional(Type.Boolean({ default: true })),
		}),
		handler: async (params, ctx) => call(() => ctx.kernel.social.update(params, ctx.principal)),
	}),
];
