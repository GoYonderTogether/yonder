// 发版附件：把可发布的 workspace 包打成 npm tarball，并写 SHA256SUMS（docs/spec/09 §5）。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXCLUDED = new Set(["packages/pi-durable"]);

export function checksumLine(contents, filename) {
	return `${createHash("sha256").update(contents).digest("hex")}  ${filename}`;
}

/** 参与打包的 workspace 包：排除 vendored 的 pi-durable 与 private 包。 */
export function packablePackages(rootDir) {
	const root = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
	const packages = [];
	for (const workspace of root.workspaces ?? []) {
		if (EXCLUDED.has(workspace)) continue;
		const manifest = JSON.parse(readFileSync(join(rootDir, workspace, "package.json"), "utf8"));
		if (manifest.private) continue;
		packages.push({ name: manifest.name, version: manifest.version, workspace });
	}
	return packages;
}

export function writeChecksums(outDir, filenames) {
	const lines = filenames
		.filter((filename) => filename.endsWith(".tgz"))
		.sort()
		.map((filename) => checksumLine(readFileSync(join(outDir, filename)), filename));
	writeFileSync(join(outDir, "SHA256SUMS"), `${lines.join("\n")}\n`);
	return lines;
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	const dryRun = argv.includes("--dry-run");
	const outDir = flag("--out") ?? join(ROOT, "dist-release");
	try {
		const packages = packablePackages(ROOT);
		console.log(`${packages.length} 个包 → ${outDir}`);
		if (dryRun) {
			for (const entry of packages) console.log(`${entry.name}@${entry.version}`);
			return 0;
		}
		mkdirSync(outDir, { recursive: true });
		for (const entry of packages) {
			execFileSync("npm", ["pack", "-w", entry.name, "--pack-destination", outDir, "--ignore-scripts"], {
				cwd: ROOT,
				stdio: "inherit",
			});
		}
		const lines = writeChecksums(outDir, readdirSync(outDir));
		console.log(`SHA256SUMS：${lines.length} 个 tarball`);
		return 0;
	} catch (error) {
		console.error(error.message);
		return 1;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
