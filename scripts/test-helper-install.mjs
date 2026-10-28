import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { acquireInstallLock, installHelper } from "./yonder-helper-install.mjs";

const evidence = await mkdtemp("/tmp/yonder-helper-install-");
console.log(`Helper installer evidence: ${evidence}`);
async function artifact(name) {
	const root = join(evidence, name);
	const app = join(root, "packages/macos-helper/dist/Yonder Helper.app");
	await mkdir(join(app, "Contents/MacOS"), { recursive: true });
	await mkdir(join(root, "scripts"));
	await cp("/bin/echo", join(app, "Contents/MacOS/fixture"));
	await writeFile(
		join(app, "Contents/Info.plist"),
		`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>fixture</string><key>CFBundleIdentifier</key><string>dev.yonder.test.${name}</string></dict></plist>`,
	);
	await writeFile(
		join(root, "scripts/yonder-permissions.mjs"),
		`console.log(JSON.stringify({release:${JSON.stringify(name)},args:process.argv.slice(2)}));\n`,
	);
	execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", app]);
	return root;
}
const first = await artifact("first"),
	second = await artifact("second");
const hash = (app) =>
	execFileSync("/usr/bin/codesign", ["-d", "--verbose=4", app], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
function runWrapper(home, release) {
	const value = JSON.parse(
		execFileSync(join(home, "yonder-permissions"), ["argv with spaces", "'"], { encoding: "utf8" }),
	);
	assert.deepEqual(value, { release, args: ["argv with spaces", "'"] });
}
test("shared host/permissions install: first install, removed old release, and rollback refresh executable wrapper", async () => {
	const home = join(evidence, "stable");
	await installHelper(first, home);
	runWrapper(home, "first");
	await writeFile(join(home, "permissions-state.json"), "retained");
	const rollback = join(evidence, "rollback");
	await cp(first, rollback, { recursive: true });
	await rm(first, { recursive: true }); // wrapper points at a genuinely missing old release.
	await installHelper(second, home);
	runWrapper(home, "second");
	await installHelper(rollback, home);
	runWrapper(home, "first");
	assert.equal(await readFile(join(home, "permissions-state.json"), "utf8"), "retained");
	assert.equal((await stat(join(home, "yonder-permissions"))).mode & 0o777, 0o700);
});
test("failed wrapper replacement restores previous signed bundle and preserves lock exclusion", async () => {
	const home = join(evidence, "restore");
	await installHelper(second, home);
	const app = join(home, "Yonder Helper.app");
	const prior = await readFile(join(app, "Contents/Info.plist"), "utf8");
	await rm(join(home, "yonder-permissions"));
	await mkdir(join(home, "yonder-permissions")); // Deterministic filesystem failure after bundle replacement.
	await assert.rejects(installHelper(join(evidence, "rollback"), home));
	assert.equal(await readFile(join(app, "Contents/Info.plist"), "utf8"), prior);
	hash(app); // real signature still valid, no app launch or TCC probe.
	execFileSync("/usr/bin/codesign", ["--verify", "--strict", app]);
	await assert.rejects(stat(join(home, "install.lock")), { code: "ENOENT" });
});
test("production guard accepts the real current artifact and rejects checkout without changing bundle or wrapper", async () => {
	const user = join(evidence, "isolated-user"),
		install = join(user, "install"),
		root = join(install, "versions/candidate"),
		home = join(user, ".local/share/yonder/helper");
	await mkdir(join(install, "versions"), { recursive: true });
	await cp(second, root, { recursive: true });
	await writeFile(join(root, ".yonder-install.json"), JSON.stringify({ version: "fixture" }));
	await symlink(root, join(install, "current"));
	const invoke = (source) =>
		execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import {installHelper} from ${JSON.stringify(new URL("./yonder-helper-install.mjs", import.meta.url).href)};await installHelper(process.argv[1]);`,
				source,
			],
			{ env: { ...process.env, HOME: user, YONDER_INSTALL: install }, stdio: "pipe" },
		);
	invoke(join(install, "current"));
	runWrapper(home, "second");
	const app = join(home, "Yonder Helper.app");
	const prior = await readFile(join(app, "Contents/MacOS/fixture"));
	const wrapper = await readFile(join(home, "yonder-permissions"));
	assert.throws(() => invoke(second), /requires the current installed release/u);
	assert.deepEqual(await readFile(join(app, "Contents/MacOS/fixture")), prior);
	assert.deepEqual(await readFile(join(home, "yonder-permissions")), wrapper);
	execFileSync("/usr/bin/codesign", ["--verify", "--strict", app]);
	await assert.rejects(stat(join(home, "install.lock")), { code: "ENOENT" });
});
test("live or unknown holder locks are never removed; proven dead holder can be recovered", async () => {
	const home = join(evidence, "locks");
	await mkdir(home);
	const release = await acquireInstallLock(home);
	const before = await readFile(join(home, "install.lock/holder.json"), "utf8");
	await assert.rejects(acquireInstallLock(home), /cannot be proven dead/u);
	assert.equal(await readFile(join(home, "install.lock/holder.json"), "utf8"), before);
	await release();
	await mkdir(join(home, "install.lock"));
	await assert.rejects(acquireInstallLock(home));
	await stat(join(home, "install.lock"));
	await rm(join(home, "install.lock"), { recursive: true }); // fixture-owned unknown lock only.
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import {acquireInstallLock} from ${JSON.stringify(new URL("./yonder-helper-install.mjs", import.meta.url).href)};await acquireInstallLock(process.argv[1]);console.log('locked');setInterval(()=>{},1000);`,
			home,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const closed = new Promise((r) => child.once("close", r));
	await new Promise((r, fail) => {
		child.stdout.once("data", r);
		child.once("error", fail);
	});
	child.kill("SIGKILL");
	await closed;
	const recovered = await acquireInstallLock(home);
	assert.equal(JSON.parse(await readFile(join(home, "install.lock/holder.json"), "utf8")).pid, process.pid);
	await recovered();
});
