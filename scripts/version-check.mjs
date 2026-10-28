import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${root}${path}`, "utf8"));
const manifest = read("package.json");
const args = process.argv.slice(2);
if (!(args.length === 1 && args[0] === "--check") && !(args.length === 2 && args[0] === "--tag")) {
	console.error("Usage: node scripts/version-check.mjs --check | --tag vX.Y.Z");
	process.exit(1);
}
const expected = args[0] === "--tag" ? args[1].replace(/^v/, "") : manifest.version;
let failed = args[0] === "--tag" && args[1] !== `v${expected}`;
for (const path of [
	"package.json",
	...manifest.workspaces
		.filter((workspace) => workspace !== "packages/pi-durable")
		.map((workspace) => `${workspace}/package.json`),
]) {
	const version = read(path).version;
	if (!/^0\.\d+\.\d{8}$/.test(version) || version !== expected) {
		console.error(`${path}: ${version} (expected ${expected})`);
		failed = true;
	}
}
if (failed) process.exit(1);
console.log(`Version check passed: ${expected}`);
