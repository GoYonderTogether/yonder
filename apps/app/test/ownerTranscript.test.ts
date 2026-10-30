import { describe, expect, it, vi } from "vitest";
import { ownerConversation } from "../src/components/chat/OwnerTranscript";

vi.mock("../src/work/lib/queries", () => ({ fetchDeviceAgents: vi.fn() }));
vi.mock("../src/work/api/client", async (original) => ({
	...(await original<typeof import("../src/work/api/client")>()),
	rpc: vi.fn(),
}));

import type { Actor } from "../src/api/types";
import { rpc } from "../src/work/api/client";
import { fetchDeviceAgents } from "../src/work/lib/queries";

const bot: Actor = { id: "bot", name: "bot", kind: "agent", ownerId: "owner", deviceId: "device" };

describe("owner transcript access", () => {
	it("never probes another owner's device", async () => {
		vi.mocked(fetchDeviceAgents).mockClear();
		expect(await ownerConversation(bot, "visitor")).toBeNull();
		expect(fetchDeviceAgents).not.toHaveBeenCalled();
	});
	it("uses the device registration mapping and an explicit device target", async () => {
		vi.mocked(fetchDeviceAgents).mockResolvedValue([{ key: "agent-key", actor: bot }]);
		vi.mocked(rpc).mockResolvedValue([{ id: "main-session", mode: "main", agent: "agent-key" }]);
		expect(await ownerConversation(bot, "owner")).toEqual({
			sessionId: "main-session",
			target: { deviceId: "device" },
		});
		expect(rpc).toHaveBeenLastCalledWith("sessions.list", {}, undefined, { deviceId: "device" });
	});
	it("rejects mismatched registration ownership before reading sessions", async () => {
		vi.mocked(rpc).mockClear();
		vi.mocked(fetchDeviceAgents).mockResolvedValue([{ key: "agent-key", actor: { ...bot, ownerId: "visitor" } }]);
		expect(await ownerConversation(bot, "owner")).toBeNull();
		expect(rpc).not.toHaveBeenCalled();
	});
});
