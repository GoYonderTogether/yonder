import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { updateRelease } from "../packages/core/dist/release/index.js";
import { installedWindowsService } from "../packages/core/dist/release/windows.js";

if (process.platform !== "win32") throw new Error("Requires native Windows");
if (await installedWindowsService()) throw new Error("Existing service must remain untouched");
const scratch = await mkdtemp(join(tmpdir(), "yonder install 中文-"));
const source = join(scratch, "source"),
	install = join(scratch, "install");
process.env.YONDER_INSTALL = install;
const git = (args, cwd = source) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
	const tracked = git(["ls-tree", "-r", "--name-only", "HEAD"], resolve(".")).split("\n");
	const added = [
		"packages/sdk/src/ipc.ts",
		"packages/core/src/runtime/windows-process.ts",
		"packages/core/src/runtime/windows-acl.ts",
		"packages/core/src/release/windows.ts",
		"scripts/yonder-windows-service.mjs",
	];
	for (const file of new Set([...tracked, ...added])) {
		try {
			await mkdir(dirname(join(source, file)), { recursive: true });
			await copyFile(resolve(file), join(source, file));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
	}
	const version = JSON.parse(await readFile(join(source, "package.json"))).version;
	git(["init"]);
	git(["add", "."]);
	git([
		"-c",
		"user.name=Yonder verification",
		"-c",
		"user.email=verification@localhost",
		"commit",
		"-m",
		"Isolated Windows installation verification snapshot",
	]);
	git(["tag", `v${version}`]);
	const first = await updateRelease({ to: version, repo: source, onProgress: console.log });
	assert.equal(first.updated, true);
	assert.equal(await realpath(join(install, "current")), await realpath(join(install, "versions", version)));
	const output = execFileSync(
		process.env.ComSpec ?? "cmd.exe",
		["/d", "/s", "/c", `""${join(install, "bin/yonder.cmd")}" version --json"`],
		{ encoding: "utf8", windowsVerbatimArguments: true },
	);
	assert.equal(JSON.parse(output).version, version);
	assert.equal((await updateRelease({ to: version, repo: source })).updated, false);
	await assert.rejects(updateRelease({ to: "0.0.1", repo: source }));
	assert.equal(await realpath(join(install, "current")), await realpath(join(install, "versions", version)));
	console.log("Windows install/build/launcher/no-op/failed-update preservation passed");
} finally {
	await rm(join(install, "current"), { force: true });
	await rm(scratch, { recursive: true, force: true });
}
