import { expect, test } from "vitest";
import { selectDevice, selectPath } from "../src/work/api/session-options";

test("workspace selection distinguishes unspecified, device-only, and multiple scoped directories", () => {
	const local = selectDevice([], "local", true);
	expect(local).toEqual([{ deviceId: "local", paths: [] }]);
	const first = selectPath(local, "local", "/workspace/one", true);
	const both = selectPath(first, "local", "/workspace/two", true);
	expect(selectPath(both, "local", "/workspace/two", true)).toEqual(both);
	const secondDevice = selectDevice(both, "paired-device", true);
	expect(secondDevice).toEqual([
		{ deviceId: "local", paths: ["/workspace/one", "/workspace/two"] },
		{ deviceId: "paired-device", paths: [] },
	]);
	expect(selectDevice(secondDevice, "local", false)).toEqual([{ deviceId: "paired-device", paths: [] }]);
	expect(selectPath(first, "local", "/workspace/one", false)).toEqual(local);
	expect(selectDevice(local, "local", false)).toEqual([]);
	expect(first).toEqual([{ deviceId: "local", paths: ["/workspace/one"] }]);
});
