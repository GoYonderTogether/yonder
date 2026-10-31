import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import { GenerationTask, type HookApi, hook } from "@earendil-works/pi-durable";

/** 一轮之内最多保留几张图片给模型看；再多的旧图换成一行文字说明。 */
export const KEEP_IMAGES_PER_TURN = 4;
/** 单张图片进入请求的 base64 上限，超过就不发图片、只留说明。 */
export const MAX_IMAGE_BASE64_BYTES = 4.5 * 1024 * 1024;

type Block = { readonly type: string; readonly text?: string; readonly data?: string; readonly mimeType?: string };
type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const isImage = (block: Block | undefined): block is Block & { data: string; mimeType: string } =>
	block?.type === "image";

/** 工具结果正文里常带一份产物路径；有就写进占位文字，模型以后还能用 read 再看。 */
function artifactPath(text: string): string | undefined {
	return (
		text.match(/"(?:path|file|artifact)"\s*:\s*"([^"]+\.(?:png|jpe?g|gif|webp|bmp))"/i)?.[1] ??
		text.match(/(\/[^\s"'()]+\.(?:png|jpe?g|gif|webp|bmp))/i)?.[1]
	);
}

function placeholder(mimeType: string, path: string | undefined): string {
	const size = `（${mimeType}）`;
	return path
		? `[较早的图片已从本轮请求中省略${size}：${path}。需要再看时用 read 读取该路径。]`
		: `[较早的图片已从本轮请求中省略${size}。需要时请重新获取。]`;
}

/**
 * 模型历史里的图片只保留当前这一轮、且最多 `KEEP_IMAGES_PER_TURN` 张。
 *
 * 工具返回的图片以 base64 进入 pi 的转录，之后每一轮请求都会重新发送。截图这类几 MB 的图片累积几轮就会把请求
 * 顶到供应商或网关的上限（实测 413 payload too large），而更早的图片对当前判断几乎没有价值。这里在请求发出的
 * 最后一刻把旧图片换成一行文字：当前轮次照常看图，历史里只留路径。转录本身不改，恢复和审计仍看到原始结果。
 */
export function pruneHistoryImages(
	messages: readonly Message[],
	options: { keep?: number; maxBytes?: number } = {},
): { messages: Message[]; removed: number } {
	const keep = options.keep ?? KEEP_IMAGES_PER_TURN;
	const maxBytes = options.maxBytes ?? MAX_IMAGE_BASE64_BYTES;
	let lastUser = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") {
			lastUser = index;
			break;
		}
	}
	const positions: Array<{ message: number; block: number }> = [];
	for (let message = 0; message < messages.length; message++) {
		const content = messages[message]?.content;
		if (!Array.isArray(content)) continue;
		for (let block = 0; block < content.length; block++)
			if (isImage(content[block])) positions.push({ message, block });
	}
	if (!positions.length) return { messages: [...messages], removed: 0 };
	// 从最新往回数：本轮之后的图片，最后 keep 张保留，其余替换。
	const turnPositions = positions.filter((position) => position.message >= lastUser);
	const keepSet = new Set(
		turnPositions
			.slice(-keep)
			.filter((position) => {
				const block = (messages[position.message]!.content as unknown as Block[])[position.block]!;
				return typeof block.data === "string" && block.data.length <= maxBytes;
			})
			.map((position) => `${position.message}:${position.block}`),
	);
	const replaced = new Map<number, ContentBlock[]>();
	let removed = 0;
	for (let message = 0; message < messages.length; message++) {
		const content = messages[message]?.content;
		if (!Array.isArray(content) || !content.some((block) => isImage(block as Block))) continue;
		const text = content
			.filter((block) => block.type === "text")
			.map((block) => (block as { text?: string }).text ?? "")
			.join(" ");
		const path = artifactPath(text);
		const next: ContentBlock[] = content.map((block, index) => {
			if (!isImage(block as Block) || keepSet.has(`${message}:${index}`)) return block as ContentBlock;
			removed++;
			return { type: "text", text: placeholder((block as { mimeType: string }).mimeType, path) };
		});
		replaced.set(message, next);
	}
	if (!replaced.size) return { messages: [...messages], removed: 0 };
	return {
		messages: messages.map((message, index) =>
			replaced.has(index) ? ({ ...message, content: replaced.get(index) } as Message) : message,
		),
		removed,
	};
}

/**
 * 挂在 generation 上：每次请求前按上面的规则裁剪，并把裁剪结果只用于这一次请求。压缩走的是另一条路径，
 * 摘要本来也只读文字，不受影响。
 */
export function imageHistoryHooks(options: { keep?: number; maxBytes?: number } = {}) {
	return [
		hook(GenerationTask, {
			beforeRequest: (request: { readonly messages: readonly Message[] }, _api: HookApi, _context: Context) =>
				pruneHistoryImages(request.messages, options),
		}),
	];
}
