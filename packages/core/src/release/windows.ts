import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { requestControl } from "../control/index.js";

const directory = () => join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "Yonder");
const registration = () => join(directory(), "service.json");
const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const powershell = () =>
	join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
const execute = promisify(execFile);

export async function windowsCommand(script: string): Promise<string> {
	const result = await execute(
		powershell(),
		[
			"-NoProfile",
			"-NonInteractive",
			"-OutputFormat",
			"Text",
			"-EncodedCommand",
			Buffer.from(
				`$ProgressPreference='SilentlyContinue'; $env:PSModulePath=Join-Path $PSHOME Modules; $ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); ${script}; exit 0`,
				"utf16le",
			).toString("base64"),
		],
		{ windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
	);
	return result.stdout.trim();
}

export interface WindowsService {
	home: string;
	install: string;
	plist: string;
	task: string;
}

export async function installedWindowsService(): Promise<WindowsService | undefined> {
	try {
		const value = JSON.parse(await readFile(registration(), "utf8")) as WindowsService;
		if (!value.home || !value.install || !value.task) throw new Error("Invalid Windows service registration");
		return { ...value, plist: registration() };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

async function status(value?: WindowsService): Promise<{
	installed: boolean;
	loaded: boolean;
	home?: string;
	install?: string;
	plist?: string;
	task?: string;
	pid?: number | null;
	ready?: boolean;
	state?: string;
}> {
	if (!value) return { installed: false, loaded: false };
	const state = await windowsCommand(
		`$t=Get-ScheduledTask -TaskName ${psQuote(value.task)} -ErrorAction SilentlyContinue; if($t){[string]$t.State}`,
	);
	let service: { pid?: number; ready?: boolean } = {};
	try {
		service = (await requestControl(value.home, { method: "service.info" })) as typeof service;
	} catch {}
	return {
		...value,
		installed: !!state,
		loaded: state === "Running",
		state: state || "missing",
		pid: service.pid ?? null,
		ready: service.ready === true,
	};
}

export async function manageWindowsService(
	action: "install" | "uninstall" | "start" | "stop" | "restart" | "status",
	install: string,
	home?: string,
) {
	let value = await installedWindowsService();
	if (action === "status") return status(value);
	if (action === "install") {
		if (!home) throw new Error("service install requires --home");
		home = resolve(home);
		await access(join(home, "yonder.yaml"));
		const runner = join(install, "current/scripts/yonder-windows-service.mjs");
		await access(runner);
		if (value) await manageWindowsService("stop", value.install);
		const task = `Yonder Harness ${Buffer.from(homedir().toLowerCase()).toString("hex").slice(-32)}`;
		const args = Buffer.from(
			JSON.stringify({ node: process.execPath, runner, home, install, path: process.env.PATH ?? "" }),
		).toString("base64");
		// The task holds paths in an encoded payload; no user path becomes PowerShell code.
		const body = `$c=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${args}'))|ConvertFrom-Json; & $c.node $c.runner $c.home $c.install $c.path; exit $LASTEXITCODE`;
		const argument = `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(body, "utf16le").toString("base64")}`;
		await windowsCommand(
			`$u=[Security.Principal.WindowsIdentity]::GetCurrent().Name; $a=New-ScheduledTaskAction -Execute ${psQuote(powershell())} -Argument ${psQuote(argument)}; $t=New-ScheduledTaskTrigger -AtLogOn -User $u; $p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited; $s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName ${psQuote(task)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
		);
		value = { home, install, task, plist: registration() };
		await mkdir(directory(), { recursive: true });
		const temporary = `${registration()}.tmp`;
		await writeFile(temporary, JSON.stringify(value));
		await rename(temporary, registration());
	}
	if (!value) {
		if (action === "uninstall") return { installed: false, loaded: false };
		throw new Error("Yonder Harness service is not installed");
	}
	if (["stop", "restart", "uninstall"].includes(action)) {
		const before = await status(value);
		if (before.loaded) {
			try {
				await requestControl(value.home, { method: "stop" });
			} catch (error) {
				if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
			}
			const until = Date.now() + 30_000;
			while ((await status(value)).loaded) {
				if (Date.now() >= until)
					throw new Error("Windows service has not finished stopping; task retained for inspection");
				await new Promise((done) => setTimeout(done, 250));
			}
		}
	}
	if (action === "uninstall") {
		await windowsCommand(`Unregister-ScheduledTask -TaskName ${psQuote(value.task)} -Confirm:$false`);
		await rm(registration(), { force: true });
		return { installed: false, loaded: false };
	}
	if (["install", "start", "restart"].includes(action))
		await windowsCommand(
			`Enable-ScheduledTask -TaskName ${psQuote(value.task)} | Out-Null; Start-ScheduledTask -TaskName ${psQuote(value.task)}`,
		);
	if (action === "stop") await windowsCommand(`Disable-ScheduledTask -TaskName ${psQuote(value.task)} | Out-Null`);
	return status(value);
}

export function windowsLauncher(install: string, node = process.execPath): string {
	const batchEscape = (value: string) => value.replaceAll("%", "%%");
	return `@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\nset "YONDER_INSTALL=${batchEscape(install)}"\r\nset "PATH=${batchEscape(join(install, "bin"))};${batchEscape(dirname(node))};%PATH%"\r\n"${batchEscape(node)}" "${batchEscape(join(install, "current/packages/cli/dist/index.js"))}" %*\r\nexit /b %errorlevel%\r\n`;
}
