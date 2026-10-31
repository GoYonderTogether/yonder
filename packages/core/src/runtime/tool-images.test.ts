import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { normalizeToolImages, TOOL_IMAGE_LIMITS } from "./tool-images.js";

const png = (bytes: number) => Buffer.alloc(bytes, 7).toString("base64");
const result = (blocks: unknown[]): ToolExecutionResult =>
	({ output: blocks, isError: false }) as unknown as ToolExecutionResult;

/** 假的图片处理器：把任何输入变成固定大小，便于断言上限被真正用上。 */
const shrink = async (_bytes: Uint8Array, _mime: string, limits: { maxBytes: number }) => ({
	data: "B".repeat(Math.min(64, limits.maxBytes)),
	mimeType: "image/jpeg",
});

test("a tool screenshot is re-encoded before it reaches the transcript", async () => {
	const large = png(7 * 1024 * 1024);
	const normalized = await normalizeToolImages(
		result([
			{ type: "text", text: '{"path":"/tmp/shot.png"}' },
			{ type: "image", data: large, mimeType: "image/png" },
		]),
		shrink,
	);
	const images = (normalized.output ?? []).filter((block) => block.type === "image") as Array<{ data: string }>;
	expect(images).toHaveLength(1);
	expect(images[0]!.data.length).toBeLessThan(large.length / 1000);
	expect((normalized.output ?? []).some((block) => block.type === "text")).toBe(true);
});

test("an image the processor cannot handle is replaced by its artifact path", async () => {
	const normalized = await normalizeToolImages(
		result([
			{ type: "text", text: '{"path":"/tmp/shot.png"}' },
			{ type: "image", data: png(64), mimeType: "image/png" },
		]),
		async () => undefined,
	);
	const text = (normalized.output ?? [])
		.filter((block) => block.type === "text")
		.map((block) => (block as { text: string }).text)
		.join(" ");
	expect(text).toContain("/tmp/shot.png");
	expect((normalized.output ?? []).some((block) => block.type === "image")).toBe(false);
});

test("results without images pass through untouched, and per-result count is capped", async () => {
	const plain = result([{ type: "text", text: "no image" }]);
	expect(await normalizeToolImages(plain, shrink)).toBe(plain);
	const many = result(Array.from({ length: 6 }, () => ({ type: "image", data: png(32), mimeType: "image/png" })));
	const capped = await normalizeToolImages(many, shrink, { maxPerResult: 2 });
	expect((capped.output ?? []).filter((block) => block.type === "image")).toHaveLength(2);
	expect(TOOL_IMAGE_LIMITS.maxBytes).toBeLessThan(4.5 * 1024 * 1024);
});
