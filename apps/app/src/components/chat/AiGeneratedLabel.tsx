import type { Actor, Conversation } from "../../api/types";

/**
 * 《人工智能生成合成内容标识办法》要求的可见标识：会话里有 Bot 时，在输入条上方固定显示一行。
 * 只标会话，不逐条标消息；群聊里有 Bot 成员同样显示。
 */
export const AI_CONTENT_LABEL = "内容由 AI 生成";

export function conversationHasBot(conv: Conversation | undefined, actors: Map<string, Actor>) {
	if (!conv || conv.kind === "notice") return false;
	for (const id of conv.memberIds) if (actors.get(id)?.kind === "agent") return true;
	return false;
}

export function AiGeneratedNotice({ conv, actors }: { conv: Conversation | undefined; actors: Map<string, Actor> }) {
	if (!conversationHasBot(conv, actors)) return null;
	return <p className="mx-auto mb-2 text-center text-caption text-muted">{AI_CONTENT_LABEL}</p>;
}
