import { describe, expect, it } from "vitest";
import { CONNECT_COMMANDS, freshHarnessDevice } from "../src/components/devices/ConnectBotDialog";

describe("接入已有 Bot", () => {
	it("offers only the connector that exists, and lists no unbuilt framework", () => {
		expect(CONNECT_COMMANDS.map((item) => item.command)).toEqual(["npx -y @yonder/connect dsh"]);
		const text = CONNECT_COMMANDS.map((item) => `${item.label} ${item.command}`).join(" ");
		expect(text).not.toContain("Hermes");
		expect(text).not.toContain("OpenClaw");
	});

	it("counts only a harness device that appeared after opening", () => {
		const baseline = new Set(["old-harness", "laptop"]);
		expect(freshHarnessDevice(undefined, baseline)).toBeUndefined();
		// Not yet observed: nothing to land on.
		expect(freshHarnessDevice([{ id: "old-harness", kind: "harness" }], null)).toBeUndefined();
		// An already known harness device is not "just connected".
		expect(freshHarnessDevice([{ id: "old-harness", kind: "harness" }], baseline)).toBeUndefined();
		// A new real device is not a harness connector.
		expect(freshHarnessDevice([{ id: "new-laptop", kind: "laptop" }], baseline)).toBeUndefined();
		expect(
			freshHarnessDevice(
				[
					{ id: "old-harness", kind: "harness" },
					{ id: "new-harness", kind: "harness" },
				],
				baseline,
			),
		).toBe("new-harness");
	});
});
