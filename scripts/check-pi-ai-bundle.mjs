import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fork = json("third_party/pi-ai/FORK_SOURCE.json");
const durable = json("packages/pi-durable/FORK_SOURCE.json");
const pkg = json("package.json");
const lock = json("package-lock.json");
assert.equal(fork.commit, durable.commit, "pi-ai and durable must come from the same fork commit");
const target = `third_party/pi-ai/${fork.tarball}`;
const integrity = `sha512-${createHash("sha512")
	.update(readFileSync(resolve(root, target)))
	.digest("base64")}`;
assert.equal(integrity, fork.integrity);
assert.equal(pkg.dependencies["@earendil-works/pi-ai"], `file:./${target}`);
assert.equal(pkg.overrides["@earendil-works/pi-ai"], "$@earendil-works/pi-ai");
const entries = Object.entries(lock.packages).filter(([path]) => path.endsWith("node_modules/@earendil-works/pi-ai"));
assert.equal(entries.length, 1, "exactly one pi-ai resolution is allowed, including UI transitive dependencies");
assert.equal(entries[0][1].resolved, `file:${target}`);
assert.equal(entries[0][1].integrity, integrity);
console.log(`pi-ai bundle verified: ${fork.commit}; one resolution; ${integrity}`);
