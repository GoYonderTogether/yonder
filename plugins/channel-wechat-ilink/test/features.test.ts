import type { PluginAPI } from "@yonder/sdk";
import { expect, it } from "vitest";
import { IlinkChannel } from "../src/channel.js";

it("reports message streaming only when enabled", () => {
	const api = { paths: { data: "/tmp" } } as PluginAPI;
	const channel = (streaming: boolean) => new IlinkChannel("test", { streaming }, api, async () => undefined);
	expect(channel(true).features.streamMode).toBe("message");
	expect(channel(false).features.streamMode).toBe("none");
});
