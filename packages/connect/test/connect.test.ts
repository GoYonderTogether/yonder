import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { chooseProfile, detectDsh, installBundle, profileBundles, removeBundle } from "../src/dsh.js";
import { cloudBase, pollPairing, startPairing, waitForPairing } from "../src/pairing.js";
import { clearConfig, dshStateDir, readConfig, writeConfig } from "../src/state.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
function temp(): string {
	const dir = mkdtempSync(join(tmpdir(), "yonder-connect-"));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe("dsh launcher detection", () => {
	test("finds dsh on PATH and lists real profiles only", () => {
		const home = temp();
		const bin = join(home, "bin");
		mkdirSync(bin, { recursive: true });
		writeFileSync(join(bin, "dsh"), "#!/bin/sh\n");
		const profiles = join(home, "dsh-home", "profiles");
		for (const name of ["web", "yonder-lab"]) mkdirSync(join(profiles, name), { recursive: true });
		writeFileSync(join(profiles, "web", "package.json"), "{}");
		writeFileSync(join(profiles, "yonder-lab", "package.json"), "{}");
		mkdirSync(join(profiles, "not-a-profile"), { recursive: true });
		const install = detectDsh({
			env: { PATH: bin, DSH_HOME: join(home, "dsh-home") },
			home,
			version: () => "0.2.1-rc.5",
		});
		expect(install.launcher).toBe(join(bin, "dsh"));
		expect(install.home).toBe(join(home, "dsh-home"));
		expect(install.profiles).toEqual(["web", "yonder-lab"]);
		expect(install.version).toBe("0.2.1-rc.5");
	});

	test("reports a missing launcher instead of guessing a path", () => {
		expect(() => detectDsh({ env: { PATH: temp() }, home: temp() })).toThrow(/找不到 dsh 命令/);
	});

	test("chooses the only non-desktop profile and refuses the Electron-owned one", () => {
		expect(chooseProfile(["desktop", "web"])).toBe("web");
		expect(chooseProfile(["web"], "web")).toBe("web");
		expect(() => chooseProfile(["desktop"])).toThrow(/desktop profile/);
		expect(() => chooseProfile([])).toThrow(/没有可用的 DSH profile/);
		expect(() => chooseProfile(["web", "tui"])).toThrow(/多个 profile/);
		expect(() => chooseProfile(["web"], "missing")).toThrow(/不存在/);
	});
});

describe("profile installation", () => {
	test("installs through the profile's own dsh plugin command", () => {
		const calls: string[][] = [];
		installBundle({
			launcher: "/x/dsh",
			profile: "web",
			spec: "/tmp/connector.tgz",
			run: (command, args) => {
				calls.push([command, ...args]);
				return { status: 0, stdout: "", stderr: "" };
			},
		});
		expect(calls).toEqual([["/x/dsh", "plugin", "--profile", "web", "add", "/tmp/connector.tgz"]]);
	});

	test("surfaces dsh's own failure text", () => {
		expect(() =>
			installBundle({
				launcher: "/x/dsh",
				profile: "web",
				spec: "pkg",
				run: () => ({ status: 1, stdout: "", stderr: "ERR_PNPM_FETCH_404" }),
			}),
		).toThrow(/ERR_PNPM_FETCH_404/);
		expect(() =>
			removeBundle({
				launcher: "/x/dsh",
				profile: "web",
				name: "@yonder/dsh-connector",
				run: () => ({ status: 2, stdout: "x", stderr: "" }),
			}),
		).toThrow(/卸载连接器失败：x/);
	});

	test("reads the bundle list from the profile manifest", () => {
		const home = temp();
		mkdirSync(join(home, "profiles", "web"), { recursive: true });
		writeFileSync(
			join(home, "profiles", "web", "package.json"),
			JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@yonder/dsh-connector"] } } }),
		);
		expect(profileBundles(home, "web")).toEqual(["@deepseek-ai/dsh-base", "@yonder/dsh-connector"]);
		expect(profileBundles(home, "missing")).toEqual([]);
	});
});

describe("pairing", () => {
	test("rejects a non-origin endpoint and plain HTTP off loopback", () => {
		expect(cloudBase("https://yonderbot.net")).toBe("https://yonderbot.net");
		expect(cloudBase("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
		expect(() => cloudBase("http://example.com")).toThrow(/HTTPS/);
		expect(() => cloudBase("https://x.test/path")).toThrow(/HTTP\(S\) 源/);
		expect(() => cloudBase("https://user:pass@x.test")).toThrow(/HTTP\(S\) 源/);
	});

	test("starts pairing through the existing device-code endpoint", async () => {
		const seen: Array<{ url: string; body: unknown }> = [];
		const call = (async (url: URL | string, init?: RequestInit) => {
			seen.push({ url: String(url), body: JSON.parse(String(init?.body)) });
			return new Response(JSON.stringify({ code: "abc", url: "https://x.test/connect?code=abc" }), { status: 201 });
		}) as unknown as typeof fetch;
		const code = await startPairing({
			endpoint: "https://x.test",
			name: "host",
			kind: "harness",
			signal: new AbortController().signal,
			fetch: call,
		});
		expect(code).toEqual({ code: "abc", url: "https://x.test/connect?code=abc" });
		expect(seen[0]?.url).toBe("https://x.test/api/device/start");
		expect(seen[0]?.body).toEqual({ name: "host", kind: "harness" });
	});

	test("polls until the human confirms and returns the one-time token", async () => {
		const statuses = ["pending", "pending", "confirmed"];
		const call = (async () => {
			const status = statuses.shift();
			return new Response(JSON.stringify(status === "confirmed" ? { status, deviceToken: "tok" } : { status }), {
				status: 200,
			});
		}) as unknown as typeof fetch;
		let sleeps = 0;
		const token = await waitForPairing({
			endpoint: "https://x.test",
			code: "abc",
			signal: new AbortController().signal,
			fetch: call,
			intervalMs: 1,
			sleep: async () => {
				sleeps += 1;
			},
		});
		expect(token).toBe("tok");
		expect(sleeps).toBe(2);
	});

	test("an unknown code ends the wait with the real reason", async () => {
		const call = (async () =>
			new Response(JSON.stringify({ error: "invalid_code" }), { status: 404 })) as unknown as typeof fetch;
		expect(await pollPairing("https://x.test", "abc", new AbortController().signal, call)).toEqual({
			status: "invalid",
		});
		await expect(
			waitForPairing({
				endpoint: "https://x.test",
				code: "abc",
				signal: new AbortController().signal,
				fetch: call,
				intervalMs: 1,
			}),
		).rejects.toThrow(/设备码已失效/);
	});
});

describe("connector state", () => {
	test("writes the device token with owner-only permissions", () => {
		const home = temp();
		const dir = dshStateDir(home);
		const path = writeConfig(dir, { endpoint: "https://x.test", deviceToken: "secret" });
		expect(readConfig(dir)).toEqual({ endpoint: "https://x.test", deviceToken: "secret" });
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ endpoint: "https://x.test" });
	});

	test("clears config and connector state, leaving other files alone", () => {
		const home = temp();
		const dir = dshStateDir(home);
		writeConfig(dir, { endpoint: "https://x.test", deviceToken: "secret" });
		writeFileSync(join(dir, "state.json"), "{}");
		writeFileSync(join(home, "unrelated.txt"), "keep");
		expect(clearConfig(dir).sort()).toEqual([`${dir}/`, join(dir, "config.json"), join(dir, "state.json")].sort());
		expect(readConfig(dir)).toBeUndefined();
		// 23 §6：显式"断开"之后连接器不留自己的状态目录。
		expect(existsSync(dir)).toBe(false);
		expect(readFileSync(join(home, "unrelated.txt"), "utf8")).toBe("keep");
	});

	test("keeps a state directory that still holds the user's own files", () => {
		const home = temp();
		const dir = dshStateDir(home);
		writeConfig(dir, { endpoint: "https://x.test", deviceToken: "secret" });
		writeFileSync(join(dir, "notes.txt"), "mine");
		clearConfig(dir);
		expect(existsSync(dir)).toBe(true);
		expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("mine");
	});
});
