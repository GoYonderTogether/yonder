import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as exec from "./exec.js";
import { manageService } from "./index.js";
import { linuxServiceUnit } from "./launchers.js";
import { windowsTask } from "./paths.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test.each(["linux", "win32"] as const)(
	"%s service commands register and control an isolated user service",
	async (platform) => {
		const root = await mkdtemp(join(tmpdir(), "ya-"));
		const install = join(root, "install"),
			home = join(root, "home");
		const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
		const calls: string[][] = [];
		let registered = false,
			active = false;
		// Substitute only the OS command boundary; keep registration files and service routing real.
		vi.spyOn(exec, "command").mockImplementation(async (program, args) => {
			expect(program).toBe(platform === "linux" ? "systemctl" : "schtasks.exe");
			calls.push(args);
			if (platform === "linux") {
				if (args.includes("stop") || args.includes("disable")) active = false;
				if (args.includes("start") || args.includes("restart")) active = true;
				return {
					code: 0,
					stdout:
						args[1] === "show" ? `ActiveState=${active ? "active" : "inactive"}\nMainPID=${active ? 1234 : 0}\n` : "",
					stderr: "",
				};
			}
			if (args.includes("/Query")) return { code: registered ? 0 : 1, stdout: "", stderr: "" };
			if (args.includes("/Create")) registered = true;
			if (args.includes("/Delete")) registered = false;
			return { code: 0, stdout: "", stderr: "" };
		});
		try {
			await mkdir(join(install, "bin"), { recursive: true });
			await mkdir(home);
			await writeFile(join(install, "bin", platform === "linux" ? "yonder" : "yonder.cmd"), "");
			await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
			Object.defineProperty(process, "platform", { value: platform, configurable: true });
			vi.stubEnv("YONDER_INSTALL", install);
			vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
			vi.stubEnv("LOCALAPPDATA", join(root, "appdata"));
			expect(await manageService("install", { home })).toMatchObject({ installed: true, loaded: platform === "linux" });
			if (platform === "linux") {
				expect(await readFile(join(root, "config/systemd/user/dev.yonder.service"), "utf8")).toBe(
					linuxServiceUnit(install, home),
				);
			} else {
				expect(await readFile(join(root, "appdata/YonderHarness/service.json"), "utf8")).toBe(
					JSON.stringify({ home, install }),
				);
			}
			expect(await manageService("stop")).toMatchObject({ installed: true, loaded: false });
			expect(await manageService("start")).toMatchObject({ installed: true, loaded: platform === "linux" });
			expect(await manageService("restart")).toMatchObject({ installed: true, loaded: platform === "linux" });
			expect(await manageService("uninstall")).toMatchObject({ installed: false, loaded: false });
			if (platform === "linux") {
				expect(calls).toContainEqual(["--user", "enable", "dev.yonder.service"]);
				expect(calls).toContainEqual(["--user", "disable", "--now", "dev.yonder.service"]);
			} else {
				expect(calls).toContainEqual([
					"/Create",
					"/SC",
					"ONLOGON",
					"/TR",
					`cmd.exe /d /c ""${join(install, "bin/yonder-service.cmd")}""`,
					"/F",
					"/RL",
					"LIMITED",
					"/TN",
					windowsTask,
				]);
				expect(calls).toContainEqual(["/Run", "/TN", windowsTask]);
				expect(calls).toContainEqual(["/End", "/TN", windowsTask]);
				expect(calls).toContainEqual(["/Delete", "/F", "/TN", windowsTask]);
				expect(calls.every((args) => args.includes("/TN") && args.includes(windowsTask))).toBe(true);
			}
		} finally {
			if (descriptor) Object.defineProperty(process, "platform", descriptor);
			await rm(root, { recursive: true, force: true });
		}
	},
);
