import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = join(root, "apps/desktop/src-tauri/runtime");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const filter = (source) =>
	!/(^|\/)(\.env[^/]*|\.yonder|auth\.json|credentials\.json|\.git|\.cache|test|tests|__tests__)(\/|$)/.test(source);
const copy = (path) => {
	const source = join(root, path);
	if (existsSync(source)) {
		mkdirSync(dirname(join(target, path)), { recursive: true });
		cpSync(source, join(target, path), { recursive: true, verbatimSymlinks: true, filter });
	}
};
copyFileSync(process.execPath, join(target, "node"));
copyFileSync(join(root, "package.json"), join(target, "package.json"));
// ponytail: copies the full dependency tree; prune when a release runtime manifest exists.
for (const path of ["node_modules", "apps/app/dist", "skills"]) copy(path);
for (const group of ["packages", "plugins"]) {
	for (const name of readdirSync(join(root, group))) {
		const dir = `${group}/${name}`;
		const manifest = join(root, dir, "package.json");
		if (!existsSync(manifest)) continue;
		const pkg = JSON.parse(readFileSync(manifest, "utf8"));
		copy(`${dir}/package.json`);
		copy(`${dir}/node_modules`);
		for (const entry of pkg.files ?? []) copy(`${dir}/${entry.includes("*") ? entry.split("/")[0] : entry}`);
	}
}
const archive = join(root, "apps/desktop/src-tauri/runtime.tar");
execFileSync("tar", ["-cf", archive, "-C", target, "."], { stdio: "inherit" });
const hash = createHash("sha256");
for await (const chunk of createReadStream(archive)) hash.update(chunk);
writeFileSync(join(root, "apps/desktop/src-tauri/runtime.sha256"), hash.digest("hex"));
