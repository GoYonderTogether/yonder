import { expect, test } from "vitest";
import { intersectResources } from "./resource-scope.js";

test("resource ceilings keep the narrower device path and reject a disjoint scope", () => {
	const base = [{ deviceId: "device-a", paths: ["/workspace"] }];
	expect(intersectResources(base, undefined)).toEqual(base);
	expect(() => intersectResources(base, [])).toThrow("No shared execution resources");
	expect(() => intersectResources([], undefined)).toThrow("No shared execution resources");
	expect(intersectResources(base, [{ deviceId: "device-a", paths: ["/workspace/notes"] }])).toEqual([
		{ deviceId: "device-a", paths: ["/workspace/notes"] },
	]);
	expect(() => intersectResources(base, [{ deviceId: "device-b", paths: [] }])).toThrow(
		"No shared execution resources",
	);
	expect(() => intersectResources(base, [{ deviceId: "device-a", paths: ["/workspace-other"] }])).toThrow(
		"No shared execution resources",
	);
	expect(
		intersectResources(
			[{ deviceId: "local", paths: ["C:\\Workspace"] }],
			[{ deviceId: "local", paths: ["c:\\workspace\\notes"] }],
		),
	).toEqual([{ deviceId: "local", paths: ["c:\\workspace\\notes"] }]);
	expect(
		intersectResources(
			[{ deviceId: "local", paths: ["\\\\server\\share\\workspace"] }],
			[{ deviceId: "local", paths: ["\\\\server\\share\\workspace\\notes"] }],
		),
	).toEqual([{ deviceId: "local", paths: ["\\\\server\\share\\workspace\\notes"] }]);
	expect(() =>
		intersectResources(
			[{ deviceId: "local", paths: ["/workspace/a\\b"] }],
			[{ deviceId: "local", paths: ["/workspace/a/b/private"] }],
		),
	).toThrow("No shared execution resources");
});
