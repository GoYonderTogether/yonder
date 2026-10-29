import {
	type Api,
	getCurrentSystemMessage,
	getSystemMessageText,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import { GenerationTask, type Harness, hook } from "@earendil-works/pi-durable";

/** 包住系统提示词的标签；开头和结尾都固定，前缀缓存才稳定（08 §2）。 */
const OPEN = "<system>";
const CLOSE = "</system>";

/** 系统提示词在 user 消息里的固定前缀。 */
export function systemBlock(text: string): string {
	return `${OPEN}\n${text}\n${CLOSE}`;
}

function withBlock(message: Message, block: string): Message {
	if (message.role !== "user") return message;
	const content = message.content;
	if (typeof content === "string") return { ...message, content: content ? `${block}\n\n${content}` : block };
	return { ...message, content: [{ type: "text", text: block }, ...content] };
}

/**
 * 把 system 角色换成第一条 user 消息最前面的 `<system>…</system>` 块（08 §2）。
 *
 * 网关（rightapi-glm）会删掉位于开头的 system/developer 消息，系统提示词整段到不了模型；同样的内容放进 user
 * 就被遵守。块的文本用 pi 自己的渲染（content 加 sections），字节只由渲染结果决定，所以每轮、以及压缩之后仍是
 * 同一前缀，前缀缓存继续有效。工具声明挂在 system 消息上，删掉会一并丢掉，因此保留一条只有 toolsAdded、没有文本
 * 的 system 消息。多轮里只有第一条 user 带这个块；没有 system 可搬时返回 `undefined`，请求保持原样。
 */
export function systemAsUserMessages(messages: readonly Message[]): Message[] | undefined {
	const head = getCurrentSystemMessage(messages);
	if (!head) return undefined;
	const text = getSystemMessageText(head);
	if (!text.length) return undefined;
	const tools = head.toolsAdded?.length
		? ([{ role: "system", content: "", toolsAdded: head.toolsAdded, timestamp: head.timestamp }] as Message[])
		: [];
	const rest = messages.filter((message) => message.role !== "system");
	const block = systemBlock(text);
	const first = rest.findIndex((message) => message.role === "user");
	if (first < 0) return [...tools, { role: "user", content: block, timestamp: head.timestamp }, ...rest];
	return [...tools, ...rest.map((message, index) => (index === first ? withBlock(message, block) : message))];
}

/** 该模型是否要求把系统提示词当 user 内容发。 */
export function systemAsUserEnabled(model: Model<Api> | undefined): boolean {
	return (model?.compat as { systemAsUser?: boolean } | undefined)?.systemAsUser === true;
}

/** 每次请求前按当前模型重新整形消息；不改动持久化的上下文。 */
export function systemAsUserHooks(harness: () => Harness) {
	return [
		hook(GenerationTask, {
			beforeRequest: async (request, api, context) => {
				const conversation = await harness().conversation(api.conversationId, context);
				const ref = (await conversation?.agent(context))?.model;
				const model = ref ? api.models.getModel(ref.provider, ref.modelId) : undefined;
				if (!systemAsUserEnabled(model)) return undefined;
				const messages = systemAsUserMessages(request.messages);
				return messages ? { messages } : undefined;
			},
		}),
	];
}
