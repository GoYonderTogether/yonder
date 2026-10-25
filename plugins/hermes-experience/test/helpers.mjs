import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkRegistrations, createRegistrationCollector, readPluginManifest } from "@yonder/sdk/testing";
export const ctx = (agent = "alpha", profile = "owner", session = "1") => ({
	agent,
	profile,
	session,
	capabilities: ["read", "write"],
	env: {},
	signal: new AbortController().signal,
});
export async function fixture(t) {
	// macOS tmpdir can include a /var symlink; exercise canonical trusted scope.
	const dir = await realpath(await mkdtemp(join(tmpdir(), "yonder-hermes-test-")));
	t?.onTestFinished(() => rm(dir, { recursive: true, force: true }));
	for (const p of ["memories", "profiles/work/memories", "skills", "sessions"])
		await mkdir(join(dir, p), { recursive: true });
	await writeFile(join(dir, "memories/MEMORY.md"), "synthetic note");
	await writeFile(join(dir, "memories/USER.md"), "synthetic preference");
	await writeFile(join(dir, "config.yaml"), '!!python/object/apply:os.system ["touch SHOULD_NOT_EXIST"]');
	await writeFile(join(dir, ".env"), "TEST_CREDENTIAL_SENTINEL=never-read-this");
	return dir;
}
export async function registered(id, config) {
	const root = resolve("plugins", id),
		module = await import(join(root, "src/index.mjs"));
	const c = createRegistrationCollector();
	await module.default.setup({ ...c.api, config });
	assert.deepEqual(await checkRegistrations(await readPluginManifest(root), c.registrations, root), []);
	return c.registrations;
}
export const scope = (dir, extra = {}) => ({
	agent: "alpha",
	profiles: ["owner"],
	memoryDir: join(dir, "memories"),
	writeMode: "exclusive-yonder",
	...extra,
});
