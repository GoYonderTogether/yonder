import { expect, it } from "vitest";
import { checkRegistrations, createRegistrationCollector } from "./testing.js";
import type { PermissionProvider } from "./types.js";

const provider: PermissionProvider = {
	id: "permission-test.os",
	scope: "contract test",
	kinds: ["camera"],
	async invoke() {
		return { platform: "contract-test", result: { state: "unknown" } };
	},
};
it("collects permissions using the manifest registration contract", async () => {
	const { api, registrations } = createRegistrationCollector();
	api.permissions.register(provider);
	expect(registrations.permissions).toEqual([provider]);
	expect(
		await checkRegistrations(
			{ id: "permission-test", apiVersion: 1, entry: "unused", contributes: { permissions: [provider.id] } },
			registrations,
			".",
		),
	).toEqual([]);
});
it.each([
	{ id: undefined },
	{ scope: 123 },
	{ id: "other-plugin" },
	{ id: "other-plugin.os" },
	{ id: "permission-test." },
	{ scope: "" },
	{ kinds: [] },
	{ kinds: ["camera", "camera"] },
	{ kinds: [""] },
	{ invoke: undefined },
])("rejects invalid provider/namespace %j", async (patch) => {
	const { api, registrations } = createRegistrationCollector();
	api.permissions.register({ ...provider, ...patch } as PermissionProvider);
	expect(
		(
			await checkRegistrations(
				{ id: "permission-test", apiVersion: 1, entry: "unused", contributes: { permissions: [provider.id] } },
				registrations,
				".",
			)
		).length,
	).toBeGreaterThan(0);
});
it("rejects duplicate and undeclared registrations", async () => {
	const { api, registrations } = createRegistrationCollector();
	api.permissions.register(provider);
	api.permissions.register(provider);
	const errors = await checkRegistrations(
		{ id: "permission-test", apiVersion: 1, entry: "unused", contributes: {} },
		registrations,
		".",
	);
	expect(errors.join("\n")).toContain("duplicate registered");
	expect(errors.join("\n")).toContain("registered but not declared");
});
