import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import plugin from "../src/index.js";
import { Ingest } from "../src/ingest.js";

async function setup(root: string, triggers?: { inbox?: boolean; bootstrap?: boolean }) {
	const { api, registrations } = createRegistrationCollector();
	const config = {
		root,
		owner: "person:test",
		timezone: "UTC",
		...(triggers ? { triggers } : {}),
	};
	await plugin.setup({ ...api, config } as PluginAPI);
	const io = { emit: async (event: never) => event };
	return {
		registrations,
		async start() {
			for (const trigger of registrations.triggers) await trigger.start(io);
		},
		async stop() {
			for (const trigger of [...registrations.triggers].reverse()) await trigger.stop();
		},
	};
}

it("leaves the configured root untouched when both automatic triggers are omitted or disabled", async () => {
	for (const settings of [undefined, { inbox: false, bootstrap: false }]) {
		const base = await mkdtemp(join(tmpdir(), "memory-optout-"));
		const root = join(base, "not-created");
		const instance = await setup(root, settings);
		try {
			await instance.start();
			await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
			await instance.stop();
			await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await instance.stop();
			await rm(base, { recursive: true, force: true });
		}
	}
});

it("does not inspect attachments or create a root for message events unless capture is explicitly enabled", async () => {
	const base = await mkdtemp(join(tmpdir(), "memory-capture-optout-"));
	const root = join(base, "not-created");
	const { api } = createRegistrationCollector();
	const ingest = new Ingest(api, { root, owner: "person:test", timezone: "UTC" } as never, []);
	try {
		await ingest.chat({
			id: "capture-off",
			ts: new Date().toISOString(),
			type: "message.in",
			from: "acct:test:owner",
			conv: "conv:test:owner",
			data: { attachments: [{ uri: join(base, "outside-secret"), mime: "application/octet-stream" }] },
		} as never);
		await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(base, { recursive: true, force: true });
	}
});

it("starts and stops explicitly enabled inbox and bootstrap triggers in a synthetic temp root", async () => {
	const base = await mkdtemp(join(tmpdir(), "memory-optin-"));
	const root = join(base, "synthetic-memory");
	const instance = await setup(root, { inbox: true, bootstrap: true });
	try {
		await instance.start();
		await access(join(root, "inbox"));
		await access(join(root, ".memory"));
		await instance.stop();
		// stop clears both intervals and closes the chokidar watcher before the test removes the tree.
	} finally {
		await instance.stop();
		await rm(base, { recursive: true, force: true });
	}
});
