import type { Participation, SocialPolicy } from "@yonder/sdk";

/** 群标签两个维度：对主人的价值、消息节奏（QA C2/C3）。 */
export type TagValue = "high" | "medium" | "low";
export type TagRhythm = "low" | "normal" | "high";
export interface GroupTags {
	value: TagValue;
	rhythm: TagRhythm;
}

/** 无标签时的兜底值，与 `social.tags` 默认值一致（IMP-02）；模式兜底沿用 routing 的群默认。 */
export const tagDefaults: GroupTags = { value: "medium", rhythm: "normal" };
export const modeDefaults: Record<"dm" | "group" | "channel", Participation> = {
	dm: "direct",
	group: "batch",
	channel: "batch",
};

/** 标签变更：未传的维度沿用当前生效值。 */
export interface GroupTagChange {
	value?: TagValue | undefined;
	rhythm?: TagRhythm | undefined;
}

export function resolveTags(tags?: GroupTagChange, base: GroupTags = tagDefaults): GroupTags {
	return { value: tags?.value ?? base.value, rhythm: tags?.rhythm ?? base.rhythm };
}

/** SDK 的 `SocialPolicy` 还没有 `tags` 字段；标签按既有会话策略存储，插件侧用结构化扩展读取。 */
export type TaggedPolicy = SocialPolicy & { tags?: GroupTagChange };

export interface GroupInfo {
	conv: string;
	tags: GroupTags;
	mode: Participation;
	revision: string;
	sources: Record<string, string>;
}

/** `social.inspect` 的生效策略 → 群标签与模式（无标签时用默认值兜底）。 */
export function groupInfo(input: {
	conv: string;
	policy: TaggedPolicy;
	revision: string;
	sources?: Record<string, string>;
	kind?: "dm" | "group" | "channel";
}): GroupInfo {
	const kind = input.kind ?? "group";
	return {
		conv: input.conv,
		tags: resolveTags(input.policy.tags),
		mode: input.policy.mode ?? modeDefaults[kind],
		revision: input.revision,
		sources: input.sources ?? {},
	};
}

/** 合并后的标签补丁：只改传入的维度，其余沿用当前生效值。 */
export function tagsPatch(current: GroupTags, change: GroupTagChange): GroupTags {
	return resolveTags(change, current);
}
