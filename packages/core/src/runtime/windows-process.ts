import { spawn } from "node:child_process";
import { join } from "node:path";

export const windowsPowerShell = () =>
	join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");

export function shellCommand(command: string): { program: string; args: string[] } {
	if (process.platform !== "win32") return { program: "/bin/bash", args: ["-c", command] };
	const source = `$ProgressPreference='SilentlyContinue'; $env:PSModulePath=Join-Path $PSHOME Modules; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; $global:LASTEXITCODE=0; ${command}; $yonderSucceeded=$?; if(-not $yonderSucceeded -and $LASTEXITCODE -eq 0){exit 1}; exit $LASTEXITCODE`;
	return {
		program: windowsPowerShell(),
		args: [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-OutputFormat",
			"Text",
			"-EncodedCommand",
			Buffer.from(source, "utf16le").toString("base64"),
		],
	};
}

/** taskkill targets the still-owned root and descendants, never a Unix negative PID. */
export function killWindowsTree(pid: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32/taskkill.exe"),
			["/pid", String(pid), "/T", "/F"],
			{ windowsHide: true, stdio: "ignore" },
		);
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0 || code === 128 ? resolve() : reject(new Error(`taskkill failed (${code})`)),
		);
	});
}
