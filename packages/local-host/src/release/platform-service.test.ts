import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as exec from "@yonder/local-host/release/exec";
import { manageService } from "@yonder/local-host/release/index";
import { linuxServiceUnit } from "@yonder/local-host/release/launchers";
import { windowsStatusTask, windowsTask } from "@yonder/local-host/release/paths";
import { afterEach, expect, test, vi } from "vitest";

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
			active = false,
			// The tray login task is a separate registration on Windows; it must not be confused with the service task.
			statusTask = false;
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
			const isStatusTask = args[args.indexOf("/TN") + 1] === windowsStatusTask;
			if (isStatusTask) {
				if (args.includes("/Query")) return { code: statusTask ? 0 : 1, stdout: "", stderr: "" };
				if (args.includes("/Create")) statusTask = true;
				if (args.includes("/Delete")) statusTask = false;
				return { code: 0, stdout: "", stderr: "" };
			}
			if (args.includes("/Query")) return { code: registered ? 0 : 1, stdout: "", stderr: "" };
			if (args.includes("/Create")) registered = true;
			if (args.includes("/Delete")) registered = false;
			return { code: 0, stdout: "", stderr: "" };
		});
		try {
			await mkdir(join(install, "bin"), { recursive: true });
			await mkdir(join(install, "current/packages/windows-status/dist"), { recursive: true });
			await mkdir(home);
			await writeFile(join(install, "bin", platform === "linux" ? "yonder" : "yonder.cmd"), "");
			await writeFile(join(install, "current/packages/windows-status/dist/YonderStatus.exe"), "");
			await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
			Object.defineProperty(process, "platform", { value: platform, configurable: true });
			vi.stubEnv("YONDER_INSTALL", install);
			vi.stubEnv("XDG_CONFIG_HOME", join(root, "config"));
			vi.stubEnv("LOCALAPPDATA", join(root, "appdata"));
			expect(await manageService("install", { home })).toMatchObject({
				installed: true,
				loaded: platform === "linux",
				...(platform === "win32" ? { statusIcon: "installed" } : {}),
			});
			if (platform === "linux") {
				expect(await readFile(join(root, "config/systemd/user/dev.yonder.service"), "utf8")).toBe(
					linuxServiceUnit(install, home),
				);
			} else {
				expect(await readFile(join(root, "appdata/YonderHarness/service.json"), "utf8")).toBe(
					JSON.stringify({ home, install }),
				);
				// The tray gets its own login task at install and a launcher that pins this home/install.
				expect(calls).toContainEqual([
					"/Create",
					"/SC",
					"ONLOGON",
					"/TR",
					`"${join(install, "bin/yonder-status.cmd")}"`,
					"/F",
					"/RL",
					"LIMITED",
					"/TN",
					"Yonder Status",
				]);
				expect(await readFile(join(install, "bin/yonder-status.cmd"), "utf8")).toContain(
					`"${join(install, "current/packages/windows-status/dist/YonderStatus.exe")}"`,
				);
			}
			expect(await manageService("stop")).toMatchObject({ installed: true, loaded: false });
			// Stopping the service must not silently unregister the icon (same rule as macOS).
			if (platform === "win32") expect(statusTask).toBe(true);
			expect(await manageService("start")).toMatchObject({ installed: true, loaded: platform === "linux" });
			expect(await manageService("restart")).toMatchObject({ installed: true, loaded: platform === "linux" });
			expect(await manageService("uninstall")).toMatchObject({ installed: false, loaded: false });
			if (platform === "linux") {
				expect(calls).toContainEqual(["--user", "enable", "dev.yonder.service"]);
				expect(calls).toContainEqual(["--user", "disable", "--now", "dev.yonder.service"]);
			} else {
				expect(statusTask).toBe(false);
				await expect(readFile(join(install, "bin/yonder-status.cmd"), "utf8")).rejects.toMatchObject({
					code: "ENOENT",
				});
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
				expect(calls.every((args) => args.includes("/TN"))).toBe(true);
			}
		} finally {
			if (descriptor) Object.defineProperty(process, "platform", descriptor);
			await rm(root, { recursive: true, force: true });
		}
	},
);
