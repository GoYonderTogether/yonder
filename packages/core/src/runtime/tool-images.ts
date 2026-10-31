import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { ImageLimits, ImageProcessor } from "@earendil-works/pi-durable/tools";

/** 工具图片比模型输入上限更严：截图只要看清界面，不需要原始分辨率。 */
export const TOOL_IMAGE_LIMITS: ImageLimits = { maxWidth: 1600, maxHeight: 1600, maxBytes: 1.5 * 1024 * 1024 };

/**
 * 工具结果的统一图片出口。
 *
 * 插件工具（桌面截图、浏览器截图等）可以把任意大小的图片直接塞进 `ToolResult.images`，内核原样写进转录；
 * 之后每一轮请求都会重新发送这些 base64，几轮就把请求顶到供应商或网关的上限。`read` 工具受 pi 自己的
 * 4.5MB 限制保护，插件工具没有。
 *
 * 这里在结果落库之前统一按模型输入的限制重新编码：截图从 7MB 降到几百 KB，当前轮次照常看图，
 * 历史里也不再累积大块 base64。确实无法处理的图片换成一行文字，指向工具写下的文件路径。
 * 更早轮次的图片由 image-history 在每次请求前裁掉。
 */
export async function normalizeToolImages(
	result: ToolExecutionResult,
	prepare: (
		bytes: Uint8Array,
		mimeType: string,
		limits: ImageLimits,
	) => Promise<{ data: string; mimeType: string } | undefined>,
	options: { limits?: ImageLimits; maxPerResult?: number } = {},
): Promise<ToolExecutionResult> {
	const output = result.output ?? [];
	const images = output.filter((block) => block.type === "image");
	if (!images.length) return result;
	const limits = options.limits ?? TOOL_IMAGE_LIMITS;
	const maxPerResult = options.maxPerResult ?? 4;
	const text = output
		.filter((block) => block.type === "text")
		.map((block) => (block as { text: string }).text)
		.join("\n");
	const path = text.match(/"(?:path|file|artifact)"\s*:\s*"([^"]+\.(?:png|jpe?g|gif|webp|bmp))"/i)?.[1];
	let kept = 0;
	let failed = 0;
	const next: typeof output = [];
	for (const block of output) {
		if (block.type !== "image") {
			next.push(block);
			continue;
		}
		if (kept >= maxPerResult) {
			failed++;
			continue;
		}
		const image = block as { data: string; mimeType: string };
		try {
			const prepared = await prepare(Buffer.from(image.data, "base64"), image.mimeType, limits);
			if (!prepared) {
				failed++;
				continue;
			}
			next.push({ type: "image", data: prepared.data, mimeType: prepared.mimeType });
			kept++;
		} catch {
			failed++;
		}
	}
	if (!failed) return { ...result, output: next };
	const note = path
		? `[已省略 ${failed} 张无法处理的图片：${path}。需要时用 read 读取该路径。]`
		: `[已省略 ${failed} 张无法处理的图片。需要时请重新获取并缩小尺寸。]`;
	return { ...result, output: [...next, { type: "text", text: note }] };
}

/** 把 Runtime 的图片处理器转成上面需要的形状。 */
export const prepareWith =
	(processor: () => Promise<ImageProcessor>) => async (bytes: Uint8Array, mimeType: string, limits: ImageLimits) =>
		(await processor()).prepare(bytes, mimeType, limits);
