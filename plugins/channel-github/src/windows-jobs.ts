import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
export const windowsJobName = (directory: string) =>
	`Yonder Update ${createHash("sha256").update(resolve(directory).toLowerCase()).digest("hex").slice(0, 32)}`;
const powershell = () =>
	join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
async function command(script: string, signal: AbortSignal) {
	const source = `$ProgressPreference='SilentlyContinue';$env:PSModulePath=Join-Path $PSHOME Modules;$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);${script};exit 0`;
	return (
		await execute(
			powershell(),
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")],
			{ signal, windowsHide: true, timeout: 10000, maxBuffer: 256000 },
		)
	).stdout.trim();
}
export async function windowsUpdateJob(action: "start" | "status" | "remove", directory: string, signal: AbortSignal) {
	const name = quote(windowsJobName(directory));
	if (action === "status")
		return command(
			`$t=Get-ScheduledTask -TaskName ${name} -ErrorAction SilentlyContinue;if($t){[string]$t.State}`,
			signal,
		);
	if (action === "remove") return command(`Unregister-ScheduledTask -TaskName ${name} -Confirm:$false`, signal);
	const payload = `& ${quote(process.execPath)} ${quote(join(directory, "update-job.mjs"))} ${quote(join(directory, "request.json"))};exit $LASTEXITCODE`;
	const args = `-NoProfile -NonInteractive -EncodedCommand ${Buffer.from(payload, "utf16le").toString("base64")}`;
	// No trigger/retry: an uncertain external update is never replayed automatically.
	return command(
		`$u=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$a=New-ScheduledTaskAction -Execute ${quote(powershell())} -Argument ${quote(args)};$p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited;$s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName ${name} -Action $a -Principal $p -Settings $s | Out-Null;Start-ScheduledTask -TaskName ${name}`,
		signal,
	);
}
