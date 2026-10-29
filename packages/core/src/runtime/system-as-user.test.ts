import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { FileCredentials } from "./credentials.js";
import { buildModels } from "./models.js";
import { systemAsUserEnabled, systemAsUserMessages, systemBlock } from "./system-as-user.js";

const system = (text: string): Message => ({ role: "system", content: text, timestamp: 0 });
const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });
const assistant = (text: string): Message =>
	({
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
		stopReason: "stop",
		timestamp: 2,
	}) as unknown as Message;

test("moves the rendered system prompt to the head of the first user message", () => {
	const messages = [system("约束 A"), user("你好"), assistant("在"), user("再来")];
	const shaped = systemAsUserMessages(messages);
	if (!shaped) throw new Error("system messages must be reshaped");
	expect(shaped.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
	expect(shaped[0]?.content).toBe(`${systemBlock("约束 A")}\n\n你好`);
	expect(shaped[2]?.content).toBe("再来");
	expect(messages[1]?.content).toBe("你好");
});

test("carries later system instructions in the same single block", () => {
	const shaped = systemAsUserMessages([system("基础"), user("hi"), system("补丁 B"), assistant("ok"), user("next")]);
	if (!shaped) throw new Error("system messages must be reshaped");
	expect(shaped.some((message) => message.role === "system")).toBe(false);
	expect(shaped[0]?.content).toBe(`${systemBlock("基础\n\n补丁 B")}\n\nhi`);
	expect(shaped.at(-1)?.content).toBe("next");
});

test("keeps the prefix byte-identical across turns so prompt caching still applies", () => {
	const first = systemAsUserMessages([system("提示词"), user("第一问")]);
	const second = systemAsUserMessages([system("提示词"), user("第一问"), assistant("第一答"), user("第二问")]);
	if (!first || !second) throw new Error("system messages must be reshaped");
	expect(second[0]?.content).toBe(first[0]?.content);
	expect(second.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
});

test("prepends the block as a text part when the user message carries images", () => {
	const shaped = systemAsUserMessages([
		system("S"),
		{
			role: "user",
			content: [
				{ type: "text", text: "看图" },
				{ type: "image", data: "AA==", mimeType: "image/png" },
			],
			timestamp: 1,
		},
	]);
	if (!shaped) throw new Error("system messages must be reshaped");
	expect(shaped[0]?.content).toEqual([
		{ type: "text", text: systemBlock("S") },
		{ type: "text", text: "看图" },
		{ type: "image", data: "AA==", mimeType: "image/png" },
	]);
});

test("leaves requests without a system message untouched", () => {
	expect(systemAsUserMessages([user("hi"), assistant("ok")])).toBeUndefined();
});

test("rightapi-glm models send the system prompt as user content by default", () => {
	const credentials = new FileCredentials(join(tmpdir(), "unused-yonder-auth.json"));
	const provider = {
		api: "openai-completions",
		baseUrl: "https://www.rightapi.ai/v1",
		models: [{ id: "glm-5.3-flash" }],
	};
	const configured = buildModels(credentials, { "rightapi-glm": provider }).getModel("rightapi-glm", "glm-5.3-flash");
	expect(systemAsUserEnabled(configured)).toBe(true);
	const off = buildModels(credentials, {
		"rightapi-glm": { ...provider, compat: { systemAsUser: false } },
	}).getModel("rightapi-glm", "glm-5.3-flash");
	expect(systemAsUserEnabled(off)).toBe(false);
	expect(systemAsUserEnabled(undefined)).toBe(false);
});
