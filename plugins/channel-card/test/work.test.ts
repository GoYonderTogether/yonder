import type { WorkControl } from "@yonder/sdk";
import { expect, it } from "vitest";
import { WorkBridge } from "../src/work.js";

it("accepts only the bound owner and cancels in-flight work on disconnect", async () => {
	const frames: unknown[] = [];
	let requestSignal: AbortSignal | undefined;
	let resolveOpen!: (value: { frame(value: unknown): void }) => void;
	const received: unknown[] = [];
	const control: WorkControl = {
		ready: async () => true,
		request: async (_owner, _method, _params, signal) => {
			requestSignal = signal;
			return new Promise(() => {});
		},
		open: async () =>
			new Promise((resolve) => {
				resolveOpen = resolve;
			}),
	};
	const bridge = new WorkBridge(control, "owner", "device", (value) => frames.push(value));
	bridge.receive({
		type: "work.request",
		ownerId: "other",
		deviceId: "device",
		requestId: "bad",
		method: "sessions.list",
	});
	expect(requestSignal).toBeUndefined();
	bridge.receive({
		type: "work.request",
		ownerId: "owner",
		deviceId: "other",
		requestId: "bad-device",
		method: "sessions.list",
	});
	expect(requestSignal).toBeUndefined();
	bridge.receive({
		type: "work.request",
		ownerId: "owner",
		deviceId: "device",
		requestId: "one",
		method: "sessions.list",
	});
	expect(requestSignal?.aborted).toBe(false);
	bridge.receive({ type: "work.open", ownerId: "owner", deviceId: "device", channelId: "channel" });
	bridge.receive({
		type: "work.frame",
		ownerId: "owner",
		deviceId: "device",
		channelId: "channel",
		frame: { t: "ping" },
	});
	resolveOpen({ frame: (value) => received.push(value) });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(received).toEqual([{ t: "ping" }]);
	bridge.close();
	expect(requestSignal?.aborted).toBe(true);
	expect(frames).toEqual([]);
});
