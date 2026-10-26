import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { manageService } from "./index.js";

test("Linux service commands register and control one user unit in an isolated command fixture", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-w4-systemd-"));
	const install = join(root, "install"),
		home = join(root, "home"),
		bin = join(root, "bin"),
		state = join(root, "state"),
		calls = join(root, "calls");
	const platform = Object.getOwnPropertyDescriptor(process, "platform"),
		before = {
			install: process.env.YONDER_INSTALL,
			config: process.env.XDG_CONFIG_HOME,
			path: process.env.PATH,
			state: process.env.YONDER_W4_STATE,
			calls: process.env.YONDER_W4_CALLS,
		};
	try {
		await mkdir(join(install, "bin"), { recursive: true });
		await mkdir(home);
		await mkdir(bin);
		await writeFile(join(install, "bin/yonder"), "#!/bin/sh\n");
		await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
		await writeFile(
			join(bin, "systemctl"),
			`#!${process.execPath}\nconst fs=require("node:fs");const a=process.argv.slice(2);fs.appendFileSync(process.env.YONDER_W4_CALLS,JSON.stringify(a)+"\\n");if(a[1]==="show"){const active=fs.existsSync(process.env.YONDER_W4_STATE);console.log("ActiveState="+(active?"active":"inactive")+"\\nMainPID="+(active?"1234":"0"));}else if(a.includes("stop")||a.includes("disable"))fs.rmSync(process.env.YONDER_W4_STATE,{force:true});else if(a.includes("restart")||a.includes("start"))fs.writeFileSync(process.env.YONDER_W4_STATE,"on");`,
		);
		await chmod(join(bin, "systemctl"), 0o700);
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		process.env.YONDER_INSTALL = install;
		process.env.XDG_CONFIG_HOME = join(root, "config");
		process.env.PATH = `${bin}:${before.path}`;
		process.env.YONDER_W4_STATE = state;
		process.env.YONDER_W4_CALLS = calls;
		expect(await manageService("install", { home })).toMatchObject({ installed: true, loaded: true, pid: 1234 });
		const unit = await readFile(join(root, "config/systemd/user/dev.yonder.harness.service"), "utf8");
		expect(unit).toContain(`--home "${home}"`);
		expect(await manageService("stop")).toMatchObject({ installed: true, loaded: false });
		expect(await manageService("start")).toMatchObject({ installed: true, loaded: true });
		expect(await manageService("restart")).toMatchObject({ installed: true, loaded: true });
		expect(await manageService("uninstall")).toMatchObject({ installed: false, loaded: false });
		const executed = (await readFile(calls, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		expect(executed).toContainEqual(["--user", "enable", "dev.yonder.harness.service"]);
		expect(executed).toContainEqual(["--user", "disable", "--now", "dev.yonder.harness.service"]);
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		for (const [key, value] of Object.entries(before)) {
			const name = {
				install: "YONDER_INSTALL",
				config: "XDG_CONFIG_HOME",
				path: "PATH",
				state: "YONDER_W4_STATE",
				calls: "YONDER_W4_CALLS",
			}[key as keyof typeof before];
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
});

test("Windows service commands register only a current-user logon task in a command fixture", async () => {
	const root = await mkdtemp("/tmp/yonder-w4-task-");
	const install = join(root, "install"),
		home = join(root, "home"),
		bin = join(root, "bin"),
		state = join(root, "task-state"),
		calls = join(root, "task-calls");
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	const before = {
		YONDER_INSTALL: process.env.YONDER_INSTALL,
		LOCALAPPDATA: process.env.LOCALAPPDATA,
		PATH: process.env.PATH,
		YONDER_W4_STATE: process.env.YONDER_W4_STATE,
		YONDER_W4_CALLS: process.env.YONDER_W4_CALLS,
	};
	try {
		await mkdir(join(install, "bin"), { recursive: true });
		await mkdir(home);
		await mkdir(bin);
		await writeFile(join(install, "bin/yonder.cmd"), "@echo off\r\n");
		await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
		await writeFile(
			join(bin, "schtasks.exe"),
			`#!${process.execPath}\nconst fs=require("node:fs");const a=process.argv.slice(2);fs.appendFileSync(process.env.YONDER_W4_CALLS,JSON.stringify(a)+"\\n");if(a.includes("/Query"))process.exit(fs.existsSync(process.env.YONDER_W4_STATE)?0:1);if(a.includes("/Create"))fs.writeFileSync(process.env.YONDER_W4_STATE,"on");if(a.includes("/Delete"))fs.rmSync(process.env.YONDER_W4_STATE,{force:true});`,
		);
		await chmod(join(bin, "schtasks.exe"), 0o700);
		Object.defineProperty(process, "platform", { value: "win32", configurable: true });
		process.env.YONDER_INSTALL = install;
		process.env.LOCALAPPDATA = join(root, "appdata");
		process.env.PATH = `${bin}:${before.PATH}`;
		process.env.YONDER_W4_STATE = state;
		process.env.YONDER_W4_CALLS = calls;
		expect(await manageService("install", { home })).toMatchObject({ installed: true, loaded: false });
		await manageService("stop");
		await manageService("start");
		expect(await manageService("uninstall")).toMatchObject({ installed: false, loaded: false });
		const executed = (await readFile(calls, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		expect(
			executed.some((args) => args.includes("/Create") && args.includes("ONLOGON") && args.includes("LIMITED")),
		).toBe(true);
		expect(executed.some((args) => args.includes("/Delete") && args.includes("/F"))).toBe(true);
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		for (const [key, value] of Object.entries(before)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(root, { recursive: true, force: true });
	}
});
