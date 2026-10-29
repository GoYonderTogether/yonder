import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bumpManifestText, changedManifests, workspacePaths } from "./bump-versions.mjs";

const MANIFEST = `{
\t"name": "@yonder/cli",
\t"version": "0.3.26102802",
\t"dependencies": {
\t\t"@yonder/sdk": "0.3.26102802",
\t\t"@earendil-works/pi-tui": "1.3.0"
\t},
\t"files": ["dist", "README.md"]
}
`;

test("只替换版本与内部 @yonder/* 依赖，保留排版", () => {
	const next = bumpManifestText(MANIFEST, "0.3.26102901");
	assert.equal(next, MANIFEST.replaceAll("0.3.26102802", "0.3.26102901"));
	assert.match(next, /"files": \["dist", "README\.md"\]/);
	assert.match(next, /"@earendil-works\/pi-tui": "1\.3\.0"/);
});

test("pi-durable 不参与统一版本", () => {
	assert.equal(
		workspacePaths({ workspaces: ["packages/core", "packages/pi-durable"] }).includes("packages/pi-durable"),
		false,
	);
});

test("changedManifests 在临时仓库里只列出需要改的文件", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-release-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const put = (name, contents) => {
		fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
		fs.writeFileSync(path.join(root, name), contents);
	};
	const rootManifest = JSON.stringify(
		{ name: "yonder", version: "0.3.26102802", workspaces: ["packages/pi-durable", "packages/sdk"] },
		null,
		"\t",
	);
	put("package.json", `${rootManifest}\n`);
	put("packages/pi-durable/package.json", '{"name":"@earendil-works/pi-durable","version":"1.3.0"}\n');
	put("packages/sdk/package.json", '{"name":"@yonder/sdk","version":"0.3.26102901"}\n');
	const changes = changedManifests(root, "0.3.26102901");
	assert.deepEqual(
		changes.map((change) => change.path),
		["package.json"],
	);
	assert.match(changes[0].contents, /"version": "0\.3\.26102901"/);
});
