import { execFileSync } from "node:child_process";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
execFileSync(`${root}node_modules/.bin/tsc`, ["-b", "packages/sdk"], { cwd: root, stdio: "inherit" });
execFileSync(
	`${root}node_modules/.bin/tsc`,
	[
		"--ignoreConfig",
		"--target",
		"es2023",
		"--module",
		"nodenext",
		"--moduleResolution",
		"nodenext",
		"--types",
		"node",
		"--strict",
		"--noUncheckedIndexedAccess",
		"--exactOptionalPropertyTypes",
		"--verbatimModuleSyntax",
		"--isolatedModules",
		"--skipLibCheck",
		"--declaration",
		"--rootDir",
		"plugins/devices/src",
		"--outDir",
		"plugins/devices/dist",
		"plugins/devices/src/index.ts",
	],
	{ cwd: root, stdio: "inherit" },
);
cpSync(new URL("../src/skills", import.meta.url), new URL("../dist/skills", import.meta.url), { recursive: true });
