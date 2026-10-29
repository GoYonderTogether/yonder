import type { PluginAPI, SocialAPI, SocialPolicy, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { type GroupTags, groupInfo, type TagRhythm, type TagValue, tagsPatch } from "./tags.js";

const text = Type.String({ minLength: 1 });
const target = { agent: text, conv: text };
const participation = Type.Union(
	["direct", "record", "mention", "batch", "folded", "mute"].map((value) => Type.Literal(value)),
);
const tagValue = Type.Union(["high", "medium", "low"].map((value) => Type.Literal(value)));
const tagRhythm = Type.Union(["low", "normal", "high"].map((value) => Type.Literal(value)));
/** 会话策略补丁：SDK 的 `SocialPolicy` 还没有 `tags`，标签按既有策略字段存储。 */
type PolicyPatch = SocialPolicy & { tags?: GroupTags };
interface PatchArgs {
	agent: string;
	conv: string;
	reason: string;
	expectedRevision?: string;
	dryRun?: boolean;
}
export function registerSocialTools(api: PluginAPI) {
	const service = () => {
		if (!api.social) throw new Error("Social API unavailable");
		return api.social;
	};
	api.tools.register({
		name: "social_inspect",
		description: "Inspect a conversation's effective social reply policy and revision.",
		capabilities: ["read"],
		parameters: Type.Object({ ...target, event: Type.Optional(text) }, { additionalProperties: false }),
		async execute(args, ctx) {
			return result(() => service().inspect(args as Parameters<SocialAPI["inspect"]>[0], ctx));
		},
	});
	api.tools.register({
		name: "social_update",
		description:
			"Preview or apply a social reply policy change. First inspect, then preview. For @-only replies set mode to mention and signals botMention to respond, ownerMention/groupOwner/everyone/keyword to record. Ask the owner to send 确认 as a separate message after preview, then apply with dryRun false and the same arguments.",
		capabilities: ["admin"],
		parameters: Type.Object(
			{
				...target,
				expectedRevision: text,
				patch: Type.Object(
					{
						mode: Type.Optional(participation),
						tags: Type.Optional(
							Type.Object(
								{ value: Type.Optional(tagValue), rhythm: Type.Optional(tagRhythm) },
								{ additionalProperties: false },
							),
						),
						batch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
						minIntervalSeconds: Type.Optional(Type.Number()),
						signals: Type.Optional(Type.Record(Type.String(), Type.String())),
						keywords: Type.Optional(Type.Array(text)),
						quiet: Type.Optional(Type.Object({ timezone: text, start: text, end: text })),
						foldedEverySeconds: Type.Optional(Type.Number()),
						judge: Type.Optional(Type.Object({ preset: text, maxCallsPerHour: Type.Optional(Type.Number()) })),
					},
					{ additionalProperties: false },
				),
				reason: text,
				dryRun: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(args, ctx) {
			return result(() => service().update(args as Parameters<SocialAPI["update"]>[0], ctx));
		},
	});
	api.tools.register({
		name: "group_info",
		description: "Read a group's value/rhythm tags and reply mode.",
		capabilities: ["read"],
		parameters: Type.Object(target, { additionalProperties: false }),
		async execute(args, ctx) {
			return result(async () => {
				const request = args as { agent: string; conv: string };
				const inspected = await service().inspect(request, ctx);
				return groupInfo({
					conv: request.conv,
					policy: inspected.policy,
					revision: inspected.revision,
					sources: inspected.sources,
				});
			});
		},
	});
	api.tools.register({
		name: "group_tag_set",
		description:
			"Preview or apply a group's value/rhythm tags. Apply with dryRun false after the owner sends 确认 as a separate message.",
		capabilities: ["admin"],
		parameters: Type.Object(
			{
				...target,
				value: Type.Optional(tagValue),
				rhythm: Type.Optional(tagRhythm),
				reason: text,
				expectedRevision: Type.Optional(text),
				dryRun: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(args, ctx) {
			return result(async () => {
				const request = args as PatchArgs & { value?: TagValue; rhythm?: TagRhythm };
				const inspected = await service().inspect({ agent: request.agent, conv: request.conv }, ctx);
				const current = groupInfo({ conv: request.conv, policy: inspected.policy, revision: inspected.revision });
				const patch: PolicyPatch = {
					tags: tagsPatch(current.tags, { value: request.value, rhythm: request.rhythm }),
				};
				return apply(service(), request, patch, inspected.revision, ctx);
			});
		},
	});
	api.tools.register({
		name: "group_mode_set",
		description:
			"Preview or apply a group's reply mode. Apply with dryRun false after the owner sends 确认 as a separate message.",
		capabilities: ["admin"],
		parameters: Type.Object(
			{
				...target,
				mode: participation,
				reason: text,
				expectedRevision: Type.Optional(text),
				dryRun: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(args, ctx) {
			return result(async () => {
				const request = args as PatchArgs & { mode: NonNullable<SocialPolicy["mode"]> };
				const inspected = await service().inspect({ agent: request.agent, conv: request.conv }, ctx);
				return apply(service(), request, { mode: request.mode }, inspected.revision, ctx);
			});
		},
	});
}
/** 先看当前生效策略再写：标签补丁要基于合并后的值，模式直接覆盖。 */
function apply(service: SocialAPI, request: PatchArgs, patch: PolicyPatch, current: string, ctx: ToolContext) {
	return service.update(
		{
			agent: request.agent,
			conv: request.conv,
			expectedRevision: request.expectedRevision ?? current,
			patch,
			reason: request.reason,
			...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
		},
		ctx,
	);
}
async function result(action: () => Promise<unknown>) {
	try {
		return { text: JSON.stringify(await action()) };
	} catch (error) {
		return { text: error instanceof Error ? error.message : String(error), isError: true };
	}
}
