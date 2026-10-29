import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
	...(await original<typeof import("node:os")>()),
	homedir: () => fixture.home,
}));

import { manageService } from "./index.js";

const uid = `gui/${process.getuid?.()}`;

/** A command-contract fixture: records argv and keeps a job list, never touches real launchd. */
const launchctlShim = (log: string, state: string) => `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
let jobs = [];
try { jobs = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, "utf8")); } catch {}
if (args[0] === "print") {
	if (!jobs.includes(args[1])) process.exit(1);
	console.log("state = running");
} else if (args[0] === "bootstrap") jobs.push(args[1] + "/" + path.basename(args[2], ".plist"));
else if (args[0] === "bootout") jobs = jobs.filter((job) => job !== args[1]);
fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(jobs));
`;

const legacyPlist = (root: string, label: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${label}</string>\n<key>ProgramArguments</key><array><string>${join(root, "legacy-install/bin/yonder")}</string><string>start</string><string>--home</string><string>${join(root, "legacy-home")}</string></array>\n</dict></plist>\n`;

const calls = async (log: string) =>
	(await readFile(log, "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as string[]);

test.skipIf(process.platform !== "darwin")(
	"macOS service commands follow the legacy launchd label that is installed and loaded",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "ya-"));
		fixture.home = root;
		const before = { path: process.env.PATH, install: process.env.YONDER_INSTALL };
		try {
			const bin = join(root, "bin"),
				log = join(root, "calls.jsonl"),
				state = join(root, "jobs.json"),
				agents = join(root, "Library/LaunchAgents");
			await mkdir(bin);
			await mkdir(agents, { recursive: true });
			await writeFile(join(agents, "dev.yonder.harness.plist"), legacyPlist(root, "dev.yonder.harness"));
			await writeFile(state, JSON.stringify([`${uid}/dev.yonder.harness`]));
			await writeFile(join(bin, "launchctl"), launchctlShim(log, state));
			await chmod(join(bin, "launchctl"), 0o700);
			process.env.PATH = `${bin}:${before.path}`;
			const legacy = join(agents, "dev.yonder.harness.plist");

			expect(await manageService("status")).toMatchObject({
				installed: true,
				loaded: true,
				label: "dev.yonder.harness",
				home: join(root, "legacy-home"),
				install: join(root, "legacy-install"),
				plist: legacy,
				state: "running",
			});
			expect(await manageService("stop")).toMatchObject({ installed: true, loaded: false });
			expect(await manageService("start")).toMatchObject({
				installed: true,
				loaded: true,
				label: "dev.yonder.harness",
			});

			const executed = await calls(log);
			expect(executed).toContainEqual(["bootout", `${uid}/dev.yonder.harness`]);
			expect(executed).toContainEqual(["bootstrap", uid, legacy]);
			// Nothing is installed under the new label until an explicit install/migrate.
			await expect(readFile(join(agents, "dev.yonder.service.plist"), "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			if (before.path === undefined) delete process.env.PATH;
			else process.env.PATH = before.path;
			if (before.install === undefined) delete process.env.YONDER_INSTALL;
			else process.env.YONDER_INSTALL = before.install;
			await rm(root, { recursive: true, force: true });
		}
	},
);

test.skipIf(process.platform !== "darwin")(
	"macOS install replaces the legacy jobs with the new labels only",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "ya-"));
		fixture.home = root;
		const before = { path: process.env.PATH, install: process.env.YONDER_INSTALL };
		try {
			const bin = join(root, "bin"),
				log = join(root, "calls.jsonl"),
				state = join(root, "jobs.json"),
				agents = join(root, "Library/LaunchAgents"),
				install = join(root, "install"),
				home = join(root, "home");
			await mkdir(bin);
			await mkdir(agents, { recursive: true });
			await mkdir(join(install, "bin"), { recursive: true });
			await mkdir(join(install, "current/scripts"), { recursive: true });
			await mkdir(join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS"), { recursive: true });
			await mkdir(home);
			await writeFile(join(home, "yonder.yaml"), "schema: 1\n");
			await writeFile(join(install, "bin/yonder"), "");
			await writeFile(join(install, "current/scripts/yonder-service-host.mjs"), "// Prepared artifact fixture.\n");
			await writeFile(join(install, "current/packages/macos/dist/YonderStatus.app/Contents/MacOS/YonderStatus"), "");
			await writeFile(join(agents, "dev.yonder.harness.plist"), legacyPlist(root, "dev.yonder.harness"));
			await writeFile(join(agents, "dev.yonder.harness.status.plist"), legacyPlist(root, "dev.yonder.harness.status"));
			await writeFile(state, JSON.stringify([`${uid}/dev.yonder.harness`, `${uid}/dev.yonder.harness.status`]));
			await writeFile(join(bin, "launchctl"), launchctlShim(log, state));
			await chmod(join(bin, "launchctl"), 0o700);
			process.env.PATH = `${bin}:${before.path}`;
			process.env.YONDER_INSTALL = install;

			await manageService("install", { home });

			const plist = join(agents, "dev.yonder.service.plist");
			expect(await readFile(plist, "utf8")).toContain("<string>dev.yonder.service</string>");
			expect(await readFile(join(agents, "dev.yonder.status.plist"), "utf8")).toContain(
				"<string>dev.yonder.status</string>",
			);
			for (const name of ["dev.yonder.harness.plist", "dev.yonder.harness.status.plist"])
				await expect(readFile(join(agents, name), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
			const executed = await calls(log);
			expect(executed).toContainEqual(["bootout", `${uid}/dev.yonder.harness`]);
			expect(executed).toContainEqual(["bootstrap", uid, plist]);
			expect(executed).toContainEqual(["bootstrap", uid, join(agents, "dev.yonder.status.plist")]);
		} finally {
			if (before.path === undefined) delete process.env.PATH;
			else process.env.PATH = before.path;
			if (before.install === undefined) delete process.env.YONDER_INSTALL;
			else process.env.YONDER_INSTALL = before.install;
			await rm(root, { recursive: true, force: true });
		}
	},
);

test("Linux service commands follow the legacy systemd unit name that is installed", async () => {
	const root = await mkdtemp(join(tmpdir(), "ya-"));
	fixture.home = root;
	const platform = Object.getOwnPropertyDescriptor(process, "platform");
	const before = { path: process.env.PATH, config: process.env.XDG_CONFIG_HOME };
	try {
		const bin = join(root, "bin"),
			callsPath = join(root, "calls"),
			state = join(root, "active"),
			units = join(root, "config/systemd/user"),
			home = join(root, "legacy-home"),
			install = join(root, "legacy-install");
		await mkdir(bin);
		await mkdir(units, { recursive: true });
		await writeFile(
			join(bin, "systemctl"),
			`#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + "\\n");
if (args[1] === "show") {
	const active = fs.existsSync(${JSON.stringify(state)});
	console.log("ActiveState=" + (active ? "active" : "inactive") + "\\nMainPID=" + (active ? "4242" : "0"));
} else if (args.includes("stop") || args.includes("disable")) fs.rmSync(${JSON.stringify(state)}, { force: true });
else if (args.includes("start") || args.includes("restart")) fs.writeFileSync(${JSON.stringify(state)}, "on");
`,
		);
		await chmod(join(bin, "systemctl"), 0o700);
		// The pre-S-N01 CLI wrote its unit under this exact name; no YonderService record is needed here.
		await writeFile(
			join(units, "dev.yonder.harness.service"),
			`# YonderService=${JSON.stringify({ home, install })}\n[Unit]\nDescription=Yonder Harness\n`,
		);
		await writeFile(state, "on");
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		process.env.PATH = `${bin}:${before.path}`;
		process.env.XDG_CONFIG_HOME = join(root, "config");

		expect(await manageService("status")).toMatchObject({
			installed: true,
			loaded: true,
			label: "dev.yonder.harness.service",
			home,
			install,
			pid: 4242,
		});
		await manageService("stop");
		expect(await manageService("start")).toMatchObject({ loaded: true, label: "dev.yonder.harness.service" });
		expect(await manageService("uninstall")).toMatchObject({ installed: false, loaded: false });
		await expect(readFile(join(units, "dev.yonder.harness.service"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});

		const executed = (await readFile(callsPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		expect(executed).toContainEqual(["--user", "stop", "dev.yonder.harness.service"]);
		expect(executed).toContainEqual(["--user", "start", "dev.yonder.harness.service"]);
		expect(executed).toContainEqual(["--user", "disable", "--now", "dev.yonder.harness.service"]);
		expect(executed.some((args) => args.includes("dev.yonder.service"))).toBe(false);
	} finally {
		if (platform) Object.defineProperty(process, "platform", platform);
		if (before.path === undefined) delete process.env.PATH;
		else process.env.PATH = before.path;
		if (before.config === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = before.config;
		await rm(root, { recursive: true, force: true });
	}
});
