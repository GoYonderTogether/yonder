import { join, posix, win32 } from "node:path";

import { SERVICE_LABEL as label, STATUS_LABEL as statusLabel } from "@yonder/local-host/release/names";
import { runtimePath, statusExecutable } from "@yonder/local-host/release/paths";

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");

function windowsBatchValue(value: string): string {
	if (/[\r\n"]/u.test(value)) throw new Error("Windows install paths must not contain quotes or line breaks");
	return value.replaceAll("%", "%%").replaceAll("^", "^^");
}
export function windowsLauncher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=${windowsBatchValue(path)}"\r\nset "YONDER_INSTALL=${windowsBatchValue(install)}"\r\n"${windowsBatchValue(node)}" "${windowsBatchValue(win32.join(install, "current/packages/cli/dist/index.js"))}" %*\r\n`;
}
export function windowsServiceLauncher(
	install: string,
	home: string,
	node = process.execPath,
	path = runtimePath(install),
): string {
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=${windowsBatchValue(path)}"\r\nset "YONDER_INSTALL=${windowsBatchValue(install)}"\r\n"${windowsBatchValue(node)}" "${windowsBatchValue(win32.join(install, "current/packages/cli/dist/index.js"))}" start --home "${windowsBatchValue(home)}" --json >> "${windowsBatchValue(win32.join(home, ".yonder/logs/harness.log"))}" 2>&1\r\n`;
}
export function launcher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, "current/packages/cli/dist/index.js"))} "$@"\n`;
}
/** Workspace binaries the install must expose; each is a real package `bin` entry. */
export const workspaceBins = [
	{ name: "yonder-executor", entry: "current/packages/device/dist/cli.js" },
	{ name: "yonder-clipboard", entry: "current/plugins/clipboard/dist/capture.js" },
	{ name: "yonder-qq", entry: "current/plugins/channel-qq/dist/setup.js" },
] as const;
/** A thin wrapper around the versioned entry, like `bin/yonder`; never a copy of the code. */
export function workspaceLauncher(
	install: string,
	entry: string,
	node = process.execPath,
	path = runtimePath(install),
): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, entry))} "$@"\n`;
}
export function windowsWorkspaceLauncher(
	install: string,
	entry: string,
	node = process.execPath,
	path = runtimePath(install),
): string {
	return `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=${windowsBatchValue(path)}"\r\nset "YONDER_INSTALL=${windowsBatchValue(install)}"\r\n"${windowsBatchValue(node)}" "${windowsBatchValue(win32.join(install, entry))}" %*\r\n`;
}
export function serviceLauncher(install: string, node = process.execPath, path = runtimePath(install)): string {
	return `#!/bin/sh\nPATH=${shellQuote(path)}\nYONDER_INSTALL=${shellQuote(install)}\nexport PATH YONDER_INSTALL\nexec ${shellQuote(node)} ${shellQuote(join(install, "current/scripts/yonder-service-host.mjs"))} "$@"\n`;
}
export function servicePlist(
	install: string,
	home: string,
	path = runtimePath(install),
	hosted = true,
	network: Record<string, string> = {},
): string {
	const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n${pair("Label", label)}
<key>ProgramArguments</key><array>${(hosted ? [join(install, "bin/yonder-service"), "--home", home] : [join(install, "bin/yonder"), "start", "--home", home, "--json"]).map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
${pair("StandardOutPath", join(home, ".yonder/logs/harness.log"))}
${pair("StandardErrorPath", join(home, ".yonder/logs/harness.log"))}
<key>EnvironmentVariables</key><dict>${pair("PATH", path)}${pair("YONDER_INSTALL", install)}${pair("YONDER_HOME", home)}${Object.entries(
		network,
	)
		.map(([key, value]) => pair(key, value))
		.join("")}</dict>
</dict></plist>\n`;
}
export function statusPlist(install: string, home: string): string {
	const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
	return `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
${pair("Label", statusLabel)}<key>ProgramArguments</key><array><string>${xml(statusExecutable(install))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
${pair("StandardOutPath", join(home, ".yonder/logs/status.log"))}${pair("StandardErrorPath", join(home, ".yonder/logs/status.log"))}
<key>EnvironmentVariables</key><dict>${pair("PATH", runtimePath(install))}${pair("YONDER_INSTALL", install)}${pair("YONDER_HOME", home)}</dict>
</dict></plist>\n`;
}
function systemdEscape(value: string): string {
	if (/[\r\n]/u.test(value)) throw new Error("systemd service paths must not contain line breaks");
	return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%");
}
const systemdExecArg = (value: string) => `"${systemdEscape(value).replaceAll("$", () => "$$")}"`;
const systemdEnvironment = (value: string) => `"${systemdEscape(value)}"`;
export function linuxServiceUnit(install: string, home: string, path = runtimePath(install)): string {
	return `# YonderService=${JSON.stringify({ home, install })}\n[Unit]\nDescription=Yonder Harness\n[Service]\nType=simple\nExecStart=${systemdExecArg(posix.join(install, "bin/yonder"))} start --home ${systemdExecArg(home)} --json\nEnvironment=${systemdEnvironment(`PATH=${path}`)}\nEnvironment=${systemdEnvironment(`YONDER_INSTALL=${install}`)}\nEnvironment=${systemdEnvironment(`YONDER_HOME=${home}`)}\nRestart=on-failure\nRestartSec=2\n[Install]\nWantedBy=default.target\n`;
}
