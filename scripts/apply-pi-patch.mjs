import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-durable"))), "..");
const { version } = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8"));
if (version !== "1.3.0") throw new Error(`Review the pi boundary patch before using ${version}`);
const args = [
	"--batch",
	"-p1",
	"-d",
	directory,
	"-i",
	fileURLToPath(new URL("../patches/pi-durable-1.3.0.patch", import.meta.url)),
];
if (spawnSync("patch", [...args, "--forward", "--dry-run"], { stdio: "ignore" }).status === 0)
	execFileSync("patch", [...args, "--forward"], { stdio: "inherit" });
else execFileSync("patch", [...args, "--reverse", "--dry-run"], { stdio: "pipe" });
