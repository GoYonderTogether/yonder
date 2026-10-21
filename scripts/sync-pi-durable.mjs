import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "https://github.com/GoYonderTogether/pi.git";
const ref = process.argv[2] ?? "yonder/1.3";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "packages/pi-durable");
const scratch = mkdtempSync(join(tmpdir(), "sync-pi-durable-"));
const git = (...args) => execFileSync("git", args, { cwd: scratch, encoding: "utf8" }).trim();
try {
	git("init", "--quiet");
	git("fetch", "--quiet", "--depth=1", repository, ref);
	git("checkout", "--quiet", "--detach", "FETCH_HEAD");
	const commit = git("rev-parse", "HEAD");
	const source = join(scratch, "packages/durable");
	const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
	if (pkg.name !== "@earendil-works/pi-durable" || pkg.version !== "1.3.0")
		throw new Error("Unexpected fork package/version");
	rmSync(target, { recursive: true, force: true });
	for (const name of ["src", "README.md", "CHANGELOG.md", "FORK.md"])
		cpSync(join(source, name), join(target, name), { recursive: true });
	cpSync(join(scratch, "LICENSE"), join(target, "LICENSE"));
	// Only build integration differs from the fork: use root tooling and npm siblings.
	pkg.scripts = { build: "tsc -b" };
	delete pkg.devDependencies;
	pkg.files = ["dist", "src", "README.md", "CHANGELOG.md", "LICENSE", "FORK.md", "FORK_SOURCE.json"];
	writeFileSync(join(target, "package.json"), `${JSON.stringify(pkg, null, "\t")}\n`);
	writeFileSync(
		join(target, "tsconfig.json"),
		`${JSON.stringify(
			{
				extends: "../../tsconfig.base.json",
				compilerOptions: {
					target: "es2024",
					lib: ["es2024"],
					noUncheckedIndexedAccess: false,
					exactOptionalPropertyTypes: false,
					allowImportingTsExtensions: true,
					rewriteRelativeImportExtensions: true,
					inlineSources: true,
				},
			},
			null,
			"\t",
		)}\n`,
	);
	writeFileSync(
		join(target, "FORK_SOURCE.json"),
		`${JSON.stringify({ repository, branch: "yonder/1.3", commit, upstream: "v1.3.0", upstreamCommit: "71023aec1546d6d677a65669c5665c0927ce0dd0" }, null, "\t")}\n`,
	);
	console.log(`Synced pi-durable 1.3.0 from ${commit}`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
