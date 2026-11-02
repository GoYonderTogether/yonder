import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as exec from "@yonder/local-host/release/exec";
import { windowsStatusTask } from "@yonder/local-host/release/paths";
import {
	installWindowsStatus,
	startWindowsStatus,
	uninstallWindowsStatus,
	windowsStatusLauncher,
} from "@yonder/local-host/release/status-windows";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

const fixture = async () => {
	const directory = await mkdtemp(join(tmpdir(), "ya-status-")),
		install = join(directory, "install"),
		home = join(directory, "home"),
		calls: string[][] = [];
	let registered = false;
	vi.spyOn(exec, "command").mockImplementation(async (program, args) => {
		expect(program).toBe("schtasks.exe");
		calls.push(args);
		if (args.includes("/Query")) return { code: registered ? 0 : 1, stdout: "", stderr: "" };
		if (args.includes("/Create")) registered = true;
		if (args.includes("/Delete")) registered = false;
		return { code: 0, stdout: "", stderr: "" };
	});
	await mkdir(join(install, "bin"), { recursive: true });
	await mkdir(join(install, "current/packages/windows-status/dist"), { recursive: true });
	await mkdir(home);
	await writeFile(join(install, "bin/yonder.cmd"), "");
	await writeFile(join(install, "current/packages/windows-status/dist/YonderStatus.exe"), "");
	return { directory, install, home, calls, isRegistered: () => registered };
};

test("install registers its own user login task and pins home/install in the launcher", async () => {
	const { directory, install, home, calls, isRegistered } = await fixture();
	try {
		await expect(installWindowsStatus(install, home)).resolves.toBe("installed");
		expect(isRegistered()).toBe(true);
		const create = calls.find((args) => args.includes("/Create"));
		expect(create).toEqual([
			"/Create",
			"/SC",
			"ONLOGON",
			"/TR",
			`"${join(install, "bin/yonder-status.cmd")}"`,
			"/F",
			"/RL",
			"LIMITED",
			"/TN",
			windowsStatusTask,
		]);
		// A fresh login task runs immediately so the icon appears right after install.
		expect(calls.at(-1)).toEqual(["/Run", "/TN", windowsStatusTask]);
		expect(await readFile(join(install, "bin/yonder-status.cmd"), "utf8")).toBe(windowsStatusLauncher(install, home));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("install without a built tray reports unavailable and registers nothing", async () => {
	const { directory, install, home, calls } = await fixture();
	try {
		await rm(join(install, "current"), { recursive: true, force: true });
		await expect(installWindowsStatus(install, home)).resolves.toBe("unavailable");
		expect(calls).toEqual([]);
		await expect(readFile(join(install, "bin/yonder-status.cmd"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("uninstall ends and deletes the tray task and its launcher, leaving the service task alone", async () => {
	const { directory, install, home, calls, isRegistered } = await fixture();
	try {
		await installWindowsStatus(install, home);
		calls.length = 0;
		await uninstallWindowsStatus(install);
		expect(isRegistered()).toBe(false);
		expect(calls).toContainEqual(["/End", "/TN", windowsStatusTask]);
		expect(calls).toContainEqual(["/Delete", "/F", "/TN", windowsStatusTask]);
		expect(calls.every((args) => args.includes(windowsStatusTask))).toBe(true);
		await expect(readFile(join(install, "bin/yonder-status.cmd"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("start only re-runs an already registered tray task", async () => {
	const { directory, install, home, calls, isRegistered } = await fixture();
	try {
		await startWindowsStatus();
		expect(calls).toEqual([["/Query", "/TN", windowsStatusTask]]);
		await installWindowsStatus(install, home);
		calls.length = 0;
		await startWindowsStatus();
		expect(calls).toEqual([
			["/Query", "/TN", windowsStatusTask],
			["/Run", "/TN", windowsStatusTask],
		]);
		expect(isRegistered()).toBe(true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
