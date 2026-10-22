import type { PluginAPI } from "@yonder/sdk";
import { describe, expect, it } from "vitest";
import { sendProgress } from "../src/sender.js";

describe("sendProgress", () => {
	it("passes the complete target and text and maps receipts", async () => {
		const calls: Array<{ to: string; text: string }> = [];
		let next: unknown = { ok: true };
		const send: PluginAPI["messages"]["send"] = async (request) => {
			calls.push({ to: request.to, text: request.text });
			return next as Awaited<ReturnType<PluginAPI["messages"]["send"]>>;
		};
		const messages = { send };
		expect(await sendProgress(messages, "conv:matrix:room:thread", "hello")).toBe("sent");
		expect(calls).toEqual([{ to: "conv:matrix:room:thread", text: "hello" }]);
		next = { ok: false };
		expect(await sendProgress(messages, "acct:telegram:alice", "no")).toBe("failed");
		next = { ok: true, uncertain: true };
		expect(await sendProgress(messages, "conv:matrix:room", "maybe")).toBe("unknown");
		next = undefined;
		expect(await sendProgress(messages, "conv:matrix:room", "bad receipt")).toBe("unknown");
		expect(await sendProgress(messages, "person:alice", "invalid kind")).toBe("failed");
		expect(calls).toHaveLength(4);
	});

	it("treats send exceptions as unknown", async () => {
		const messages: Pick<PluginAPI["messages"], "send"> = {
			send: async () => {
				throw new Error("transport lost");
			},
		};
		expect(await sendProgress(messages, "acct:telegram:alice", "hello")).toBe("unknown");
	});
});
