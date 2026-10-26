import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	compareVersions,
	latestRelease,
	launcher,
	linuxServiceUnit,
	managedVersionLink,
	readChangelog,
	readDocs,
	releaseInfo,
	selectChangelog,
	serviceLauncher,
	servicePlist,
	statusPlist,
	unlinkManagedVersionLink,
	unloadService,
	windowsLauncher,
	windowsServiceLauncher,
} from "./index.js";

test("Linux user unit and Windows wrappers keep installed code separate from home", () => {
	const unit = linuxServiceUnit("/opt/yonder app", "/tmp/agent home", "/usr/bin:/bin");
	expect(unit).toContain('ExecStart="/opt/yonder app/bin/yonder" start --home "/tmp/agent home" --json');
	expect(unit).toContain("WantedBy=default.target");
	expect(unit).toContain("Restart=on-failure");
	expect(unit).not.toContain("User=root");
	const special = linuxServiceUnit("/opt/Yonder $d% app", "/tmp/Agent $h% x", "/bin:/tmp/$p% dir");
	expect(special).toContain('ExecStart="/opt/Yonder $$d%% app/bin/yonder" start --home "/tmp/Agent $$h%% x" --json');
	expect(special).toContain('Environment="YONDER_HOME=/tmp/Agent $h%% x"');
	expect(special).toContain('Environment="PATH=/bin:/tmp/$p%% dir"');
	expect(special).not.toContain('Environment="YONDER_HOME=/tmp/Agent $$h');
	const wrapper = windowsLauncher("C:\\Yonder App", "C:\\Node\\node.exe", "C:\\Node");
	expect(wrapper).toContain('"C:\\Node\\node.exe" "C:\\Yonder App\\current\\packages\\cli\\dist\\index.js" %*');
	expect(windowsServiceLauncher("C:\\Yonder App", "C:\\Agent Home", "C:\\Node\\node.exe", "C:\\Node")).toContain(
		'start --home "C:\\Agent Home" --json',
	);
});

test("version-link cleanup preserves real directories and links outside versions", async () => {
	const install = await mkdtemp("/tmp/yonder-w4-links-");
	const current = join(install, "current"),
		versions = join(install, "versions"),
		version = join(versions, "0.2.1"),
		outside = join(install, "outside");
	try {
		await mkdir(version, { recursive: true });
		await mkdir(outside);
		await writeFile(join(outside, "keep"), "outside");
		await symlink(version, current, "dir");
		expect(await managedVersionLink(install, current)).toBe("0.2.1");
		await unlinkManagedVersionLink(install, current);
		expect((await stat(version)).isDirectory()).toBe(true);
		await mkdir(current);
		await writeFile(join(current, "keep"), "real directory");
		await expect(unlinkManagedVersionLink(install, current)).rejects.toThrow("unmanaged current path");
		expect(await readFile(join(current, "keep"), "utf8")).toBe("real directory");
		await rm(current, { recursive: true });
		await symlink(outside, current, "dir");
		await expect(unlinkManagedVersionLink(install, current)).rejects.toThrow("outside managed versions");
		expect(await readFile(join(outside, "keep"), "utf8")).toBe("outside");
	} finally {
		await rm(install, { recursive: true, force: true });
	}
});

test("release parsing, real docs and local launcher/plist files need no harness home", async () => {
	expect(compareVersions("0.10.0", "v0.2.0")).toBe(1);
	expect(latestRelease(["v0.2.0", "v0.10.0", "v0.11.0-rc.1", "main"])).toBe("v0.10.0");
	expect(latestRelease(["v0.2.0", "v0.3.0-beta.1", "v0.3.0-beta.2"], true)).toBe("v0.3.0-beta.2");
	expect(compareVersions("0.2.26102001-beta.1", "0.2.26102001")).toBe(-1);
	expect(compareVersions("0.2.26102001-beta.10", "0.2.26102001-beta.2")).toBe(1);
	expect(compareVersions("0.2.26102002", "0.1.2026102001")).toBe(1);
	expect(selectChangelog("## [0.2.0]\nSecond\n\n## [0.1.0]\nFirst\n", "0.1.0", "0.2.0")).toBe("## [0.2.0]\nSecond");
	const info = await releaseInfo();
	expect(info.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u);
	expect(await readDocs()).toContain("文档地图");
	expect(await readDocs(undefined, true)).toContain("spec/09-cli-release.md");
	await expect(readDocs("../package.json")).rejects.toThrow("inside docs/");
	expect(typeof (await readChangelog())).toBe("string");
	const directory = await mkdtemp(join(tmpdir(), "yonder-release & '"));
	try {
		const wrapper = join(directory, "yonder"),
			plist = join(directory, "service.plist");
		await writeFile(wrapper, launcher(directory));
		execFileSync("/bin/sh", ["-n", wrapper]);
		const text = servicePlist(directory, directory);
		await writeFile(plist, text);
		expect(text).toContain("bin/yonder-service</string>");
		expect(text).not.toContain("<string>start</string>");
		expect(servicePlist(directory, directory, "/bin", false)).toContain("<string>--json</string>");
		await writeFile(wrapper, serviceLauncher(directory));
		execFileSync("/bin/sh", ["-n", wrapper]);
		expect(await readFile(wrapper, "utf8")).toContain("current/scripts/yonder-service-host.mjs");
		expect(text).toContain("&amp;");
		expect(text).toContain("&apos;");
		expect(text.match(/<key>PATH<\/key>|<key>YONDER_INSTALL<\/key>|<key>YONDER_HOME<\/key>/gu) ?? []).toHaveLength(3);
		expect(await readFile(wrapper, "utf8")).toContain(process.execPath);
		if (process.platform === "darwin") {
			execFileSync("plutil", ["-lint", "--", plist]);
			const icon = statusPlist(directory, directory);
			await writeFile(plist, icon);
			execFileSync("plutil", ["-lint", "--", plist]);
			expect(icon).toContain("<key>KeepAlive</key><false/>");
			expect(icon).toContain("YonderStatus.app/Contents/MacOS/YonderStatus");
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test.skipIf(process.platform !== "darwin" || process.env.YONDER_TEST_LAUNCHD !== "1")(
	"real launchd unload waits for the old process and registration before bootstrap",
	async () => {
		const root = await mkdtemp("/tmp/yonder-launchd-");
		const label = `dev.yonder.harness.check.${process.pid}`;
		const service = `gui/${process.getuid?.()}/${label}`;
		const plist = `${root}/check.plist`,
			ready = `${root}/ready`;
		const script = `require("fs").writeFileSync(${JSON.stringify(ready)},"ready");process.on("SIGTERM",()=>setTimeout(()=>process.exit(0),300));setInterval(()=>{},1000)`;
		try {
			await writeFile(
				plist,
				`<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>-e</string><string>${script.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>`,
			);
			execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, plist]);
			await expect.poll(() => readFile(ready, "utf8").catch(() => ""), { timeout: 20000 }).toBe("ready");
			await unloadService(service);
			await rm(ready);
			execFileSync("launchctl", ["bootstrap", `gui/${process.getuid?.()}`, plist]);
			await expect.poll(() => readFile(ready, "utf8").catch(() => ""), { timeout: 20000 }).toBe("ready");
		} finally {
			await unloadService(service);
			await rm(root, { recursive: true, force: true });
		}
	},
	45000,
);
