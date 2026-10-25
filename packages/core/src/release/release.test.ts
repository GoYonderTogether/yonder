import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	compareVersions,
	latestRelease,
	launcher,
	readChangelog,
	readDocs,
	releaseInfo,
	selectChangelog,
	serviceLauncher,
	servicePlist,
	statusPlist,
	unloadService,
} from "./index.js";

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
