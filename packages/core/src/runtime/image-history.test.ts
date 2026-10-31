import type { Message } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { KEEP_IMAGES_PER_TURN, pruneHistoryImages } from "./image-history.js";

const image = (size = 8) => ({ type: "image" as const, data: "A".repeat(size), mimeType: "image/png" });
const text = (value: string) => ({ type: "text" as const, text: value });
const toolResult = (blocks: unknown[], toolName = "native-automation_desktop"): Message =>
	({
		role: "toolResult",
		toolCallId: "c1",
		toolName,
		content: blocks,
		isError: false,
		timestamp: 1,
	}) as unknown as Message;
const user = (blocks: unknown[] = [text("看看这个")]): Message =>
	({ role: "user", content: blocks, timestamp: 1 }) as unknown as Message;

test("images from earlier turns become a text line that keeps the artifact path", () => {
	const messages = [
		user(),
		toolResult([text('{"path":"/tmp/shot-a.png","bytes":100}'), image()]),
		user([text("再看一张")]),
		toolResult([text('{"path":"/tmp/shot-b.png","bytes":100}'), image()]),
	];
	const pruned = pruneHistoryImages(messages, { keep: 1 });
	expect(pruned.removed).toBe(1);
	const first = pruned.messages[1]!.content as Array<{ type: string; text?: string }>;
	expect(first.some((block) => block.type === "image")).toBe(false);
	expect(first.map((block) => block.text ?? "").join(" ")).toContain("/tmp/shot-a.png");
	// 最近一轮的图片原样保留。
	const second = pruned.messages[3]!.content as Array<{ type: string }>;
	expect(second.some((block) => block.type === "image")).toBe(true);
	// 原始消息不被修改。
	expect((messages[1]!.content as Array<{ type: string }>).some((block) => block.type === "image")).toBe(true);
});

test("no image is dropped from the current turn, even past the per-turn cap is enforced newest-first", () => {
	const many = Array.from({ length: KEEP_IMAGES_PER_TURN + 2 }, () => image());
	const messages = [user(), toolResult([text("shots"), ...many])];
	const pruned = pruneHistoryImages(messages);
	expect(pruned.removed).toBe(2);
	const kept = (pruned.messages[1]!.content as Array<{ type: string }>).filter((block) => block.type === "image");
	expect(kept).toHaveLength(KEEP_IMAGES_PER_TURN);
});

test("an oversized image is replaced even inside the current turn", () => {
	const messages = [user(), toolResult([text('{"path":"/tmp/big.png"}'), image(64)])];
	const pruned = pruneHistoryImages(messages, { maxBytes: 32 });
	expect(pruned.removed).toBe(1);
	expect(pruned.messages[1]!.content as Array<{ type: string }>).toSatisfy((blocks: Array<{ type: string }>) =>
		blocks.every((block) => block.type !== "image"),
	);
});

test("a conversation without images is returned unchanged", () => {
	const messages = [user(), toolResult([text("no image")])];
	const pruned = pruneHistoryImages(messages);
	expect(pruned.removed).toBe(0);
	expect(pruned.messages).toEqual(messages);
});
