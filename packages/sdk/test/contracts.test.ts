import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { acct, agent, conv, definePlugin, parseRef, person, plugin, session } from "../src/index.js";
import { checkPlugin } from "../src/testing.js";

test("SDK references, identity helpers and real plugin registration contract", async () => {
	assert.deepEqual(parseRef(conv("cli", "group:42")), { kind: "conv", channel: "cli", id: "group:42" });
	for (const ref of [acct("cli", "local"), person("owner"), agent("main"), session(42), plugin("context-files")])
		assert.equal(typeof parseRef(ref).id, "string");
	assert.throws(() => acct("bad/channel", "x"));
	assert.throws(() => person("has space"));
	assert.throws(() => session("not-an-integer"));
	const value = { setup() {} };
	assert.equal(definePlugin(value), value);
	const dir = await mkdtemp(join(tmpdir(), "yonder-sdk-"));
	const manifest = {
		apiVersion: 1,
		id: "contract-check",
		entry: "./index.mjs",
		contributes: { contexts: ["contract"] },
	};
	try {
		await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module", yonder: manifest }));
		await writeFile(
			join(dir, "index.mjs"),
			'export default { setup(api) { api.contexts.register({ id: "contract", placement: "system", render: () => undefined }); } };',
		);
		assert.deepEqual(await checkPlugin(dir), []);
		manifest.contributes.contexts.push("missing");
		await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module", yonder: manifest }));
		assert.deepEqual(await checkPlugin(dir), ["contract-check: contexts.missing: declared but not registered"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
