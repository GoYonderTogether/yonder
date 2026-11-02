import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	artifactDirectory,
	NODE_VERSION,
	SOURCE_FILES,
	sourceIdentity,
	validateArtifact,
	verifyArtifact,
} from "./artifacts.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "yonder-native-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	for (const file of SOURCE_FILES) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), `${file}\n`);
	}
	const source = sourceIdentity(root);
	const binary = Buffer.from("binary checksum test bytes");
	const manifest = {
		format: 1,
		interfaceVersion: 1,
		platform: "win32",
		arch: "x64",
		napiVersion: 8,
		nodeVersion: NODE_VERSION,
		repository: "https://github.com/GoYonderTogether/yonder",
		sourceCommit: "a".repeat(40),
		sourceSha256: source.sha256,
		sources: source.files,
		binarySha256: hash(binary),
		headersSha256: "b".repeat(64),
		nodeLibrarySha256: "c".repeat(64),
		msvcVersion: "14.44",
		windowsSdkVersion: "10.0.26100.0",
	};
	return { root, source, binary, manifest };
}

test("offline verification matches both content hashes and build metadata", (t) => {
	const { root, source, binary, manifest } = fixture(t);
	assert.equal(validateArtifact(manifest, binary, source, "x64"), manifest);
	const dir = artifactDirectory("x64", root);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
	writeFileSync(join(dir, "owner-pipe.node"), binary);
	assert.deepEqual(verifyArtifact("x64", root), manifest);
	// Unrelated Yonder releases do not require rebuilding the unchanged native component.
	writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.3.26110201" }));
	assert.deepEqual(verifyArtifact("x64", root), manifest);
});

test("source identity is independent of Windows checkout newline conversion", (t) => {
	const { root, source } = fixture(t);
	for (const file of SOURCE_FILES) writeFileSync(join(root, file), `${file}\r\n`);
	assert.deepEqual(sourceIdentity(root), source);
});

test("changed source, corrupted binary, wrong architecture and incompatible ABI fail closed", (t) => {
	const { source, binary, manifest } = fixture(t);
	assert.throws(() => validateArtifact(manifest, Buffer.from("changed"), source, "x64"), /binary SHA256/);
	assert.throws(
		() => validateArtifact(manifest, binary, { ...source, sha256: "d".repeat(64) }, "x64"),
		/sources changed/,
	);
	for (const mutation of [
		{ arch: "arm64" },
		{ napiVersion: 9 },
		{ interfaceVersion: 2 },
		{ nodeVersion: "24.0.0" },
		{ repository: "https://example.org/other" },
		{ sourceCommit: "main" },
		{ headersSha256: "" },
		{ nodeLibrarySha256: "" },
		{ msvcVersion: "" },
		{ windowsSdkVersion: "" },
	])
		assert.throws(() => validateArtifact({ ...manifest, ...mutation }, binary, source, "x64"));
	assert.throws(() => artifactDirectory("../other"), /Unsupported/);
});

test("changing any native build input invalidates the committed artifact", (t) => {
	const { root, source } = fixture(t);
	for (const file of SOURCE_FILES) {
		writeFileSync(join(root, file), `${file}\nchanged\n`);
		assert.notEqual(sourceIdentity(root).sha256, source.sha256);
		writeFileSync(join(root, file), `${file}\n`);
	}
});
