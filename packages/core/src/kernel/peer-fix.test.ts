import { expect, test } from "vitest";
import type { AgentConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import { canReceivePeerAsk, peerFix, withDefaultPeer } from "./peer.js";

const legacy = {
	id: "hermes",
	owner: "person:owner",
	defaultProfile: "owner",
	defaults: {},
	profiles: { owner: { level: "bypass" } },
	bindings: [{ id: "feishu", match: { channel: "feishu" }, session: "main", profile: "owner" }],
} as unknown as AgentConfig;

test("an older agent without a peer binding is reported and the fix matches what a new agent gets", () => {
	expect(canReceivePeerAsk(legacy)).toBe(false);
	const fix = peerFix(legacy, "local", testModel)!;
	expect(fix).toContain("peer:");
	expect(fix).toContain("channel: agent");
	expect(canReceivePeerAsk(withDefaultPeer(legacy, false, "local", testModel))).toBe(true);
});
