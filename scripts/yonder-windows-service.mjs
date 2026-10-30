import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";

const payload =
	process.argv[2] === "--payload" ? JSON.parse(Buffer.from(process.argv[3], "base64").toString("utf8")) : undefined;
const [home, install, savedPath] = payload ? [payload.home, payload.install, payload.path] : process.argv.slice(2);
if (process.platform !== "win32" || !home || !install) throw new Error("Windows service requires home and install");
await mkdir(join(home, ".yonder/logs"), { recursive: true });
const log = await open(join(home, ".yonder/logs/harness.log"), "a");
const child = spawn(
	process.execPath,
	[join(install, "current/packages/cli/dist/index.js"), "start", "--home", home, "--json"],
	{
		windowsHide: true,
		stdio: ["ignore", log.fd, log.fd],
		env: {
			...process.env,
			YONDER_HOME: home,
			YONDER_INSTALL: install,
			PATH: [join(install, "bin"), dirname(process.execPath), savedPath].filter(Boolean).join(delimiter),
		},
	},
);
const traySource = await readFile(new URL("./yonder-windows-tray.ps1", import.meta.url), "utf8");
const trayConfig = Buffer.from(
	JSON.stringify({
		node: process.execPath,
		cli: join(install, "current/packages/cli/dist/index.js"),
		home,
		receipt: join(home, ".yonder/windows-tray.json"),
	}),
).toString("base64");
const trayScript = `$ProgressPreference='SilentlyContinue';$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');$config=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${trayConfig}')) | ConvertFrom-Json;${traySource}`;
const tray = spawn(
	join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
	["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", Buffer.from(trayScript, "utf16le").toString("base64")],
	{ windowsHide: true, stdio: ["ignore", log.fd, log.fd] },
);
tray.on("error", (error) => console.error("Windows tray failed", error.message));
child.once("error", async (error) => {
	tray.kill();
	console.error(error);
	await log.close();
	process.exitCode = 1;
});
child.once("exit", async (code) => {
	tray.kill();
	await rm(join(home, ".yonder/windows-tray.json"), { force: true });
	await log.close();
	process.exitCode = code ?? 1;
});
