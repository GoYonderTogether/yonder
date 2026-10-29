import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checksumLine, packablePackages, writeChecksums } from "./pack-runtime.mjs";

test("打包清单排除 pi-durable 与 private 包", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-pack-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const put = (name, value) => {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, "\t")}\n`);
	};
	const workspaces = ["packages/cli", "packages/pi-durable", "apps/app"];
	put("package.json", { name: "yonder", version: "0.3.26102901", workspaces });
	put("packages/cli/package.json", { name: "@yonder/cli", version: "0.3.26102901" });
	put("packages/pi-durable/package.json", { name: "@earendil-works/pi-durable", version: "1.3.0" });
	put("apps/app/package.json", { name: "@yonder/app", version: "0.3.26102901", private: true });
	assert.deepEqual(packablePackages(root), [
		{ name: "@yonder/cli", version: "0.3.26102901", workspace: "packages/cli" },
	]);
});

test("SHA256SUMS 按文件名排序并给出真实摘要", (t) => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-pack-out-"));
	t.after(() => fs.rmSync(out, { recursive: true, force: true }));
	fs.writeFileSync(path.join(out, "b-1.0.0.tgz"), "b");
	fs.writeFileSync(path.join(out, "a-1.0.0.tgz"), "a");
	fs.writeFileSync(path.join(out, "SHA256SUMS"), "");
	const lines = writeChecksums(out, fs.readdirSync(out));
	assert.equal(lines.length, 2);
	assert.match(lines[0], /^[0-9a-f]{64} {2}a-1\.0\.0\.tgz$/);
	assert.equal(fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8"), `${lines.join("\n")}\n`);
	// sha256("a")
	assert.equal(lines[0].split(" ")[0], "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
	assert.equal(checksumLine("a", "a-1.0.0.tgz"), lines[0]);
});
