import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import { registerContexts } from "../src/contexts.js";
import { event } from "./harness.js";

it("fails closed on private/malformed metadata, symlinks and traversal; admits public markdown", async () => {
	const root = await mkdtemp(join(tmpdir(), "memory-context-security-"));
	const outside = await mkdtemp(join(tmpdir(), "memory-context-outside-"));
	try {
		await mkdir(join(root, "me"));
		await mkdir(join(root, "private"));
		await writeFile(join(root, "me/now.md"), "---\nprivate: true\n---\nSECRET_PRIVATE");
		await writeFile(join(root, "me/profile.md"), "---\nprivate: [broken\n---\nSECRET_BAD_YAML");
		await writeFile(join(root, "me/mind.md"), "public markdown");
		await writeFile(join(root, "private/secret.md"), "SECRET_PRIVATE_DIR");
		await writeFile(join(outside, "secret.md"), "SECRET_OUTSIDE");
		await symlink(outside, join(root, "me/linkdir"));
		await symlink(join(outside, "secret.md"), join(root, "me/link.md"));
		const { api, registrations } = createRegistrationCollector();
		const config = {
			root,
			owner: "person:test",
			timezone: "UTC",
			allowedAgents: ["test"],
			allowedSourceConversations: ["conv:test:owner"],
		};
		const full = {
			...api,
			identity: {
				async account() {
					return { person: "person:test" };
				},
			},
		} as never;
		registerContexts(full, config as never);
		const contribution = registrations.contexts.find((x) => x.id === "memory-core");
		expect(contribution).toBeDefined();
		const text = await contribution?.render({ agent: "test", event: event() } as never);
		expect(text).toContain("public markdown");
		for (const secret of ["SECRET_PRIVATE", "SECRET_BAD_YAML", "SECRET_PRIVATE_DIR", "SECRET_OUTSIDE"])
			expect(text).not.toContain(secret);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});

it("allows allowed agents on non-chat events and still gates chat messages", async () => {
	const { allowedRun } = await import("../src/contexts.js");
	const config = {
		root: "/x",
		owner: "person:test",
		timezone: "UTC",
		allowedAgents: ["keeper"],
		allowedSourceConversations: ["conv:test:owner"],
	} as never;
	const api = {
		identity: {
			async account() {
				return { person: "person:test" };
			},
		},
	} as never;
	const cron = {
		...event(),
		type: "cron.memory-evening",
		from: "plugin:cron",
		conv: "conv:cron:memory-evening",
	} as never;
	expect(await allowedRun(api, config, "keeper", cron)).toBe(true);
	expect(await allowedRun(api, config, "other", cron)).toBe(false);
	expect(await allowedRun(api, config, undefined, cron)).toBe(false);
	const elsewhere = { ...event(), conv: "conv:test:other" } as never;
	expect(await allowedRun(api, config, "keeper", elsewhere)).toBe(false);
});
