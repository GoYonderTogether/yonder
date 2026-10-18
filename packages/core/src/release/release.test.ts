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
	servicePlist,
} from "./index.js";

test("release parsing, real docs and local launcher/plist files need no harness home", async () => {
	expect(compareVersions("0.10.0", "v0.2.0")).toBe(1);
	expect(latestRelease(["v0.2.0", "v0.10.0", "v0.11.0-rc.1", "main"])).toBe("v0.10.0");
	expect(selectChangelog("## [0.2.0]\nSecond\n\n## [0.1.0]\nFirst\n", "0.1.0", "0.2.0")).toBe("## [0.2.0]\nSecond");
	const info = await releaseInfo();
	expect(info.version).toMatch(/^\d+\.\d+\.\d+$/u);
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
		expect(text).toContain("&amp;");
		expect(text).toContain("&apos;");
		expect(text.match(/<key>PATH<\/key>|<key>YONDER_INSTALL<\/key>|<key>YONDER_HOME<\/key>/gu) ?? []).toHaveLength(3);
		expect(await readFile(wrapper, "utf8")).toContain(process.execPath);
		if (process.platform === "darwin") execFileSync("plutil", ["-lint", "--", plist]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
