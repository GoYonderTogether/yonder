import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { requestControl } from "../packages/core/dist/index.js";
import { installedWindowsService, windowsCommand } from "../packages/core/dist/release/windows.js";

if (process.platform !== "win32") throw new Error("Native Windows required");
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const boot = () =>
	windowsCommand("(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')");
const [action, reportArg] = process.argv.slice(2),
	report = resolve(reportArg ?? "");
if (!reportArg || !["prepare", "check", "status", "cleanup"].includes(action))
	throw new Error("Usage: node test-windows-reboot.mjs prepare|check|status|cleanup <report.json>");
if (action === "prepare") {
	const service = await installedWindowsService();
	assert.ok(service, "Install the isolated acceptance service first");
	const info = await requestControl(service.home, { method: "service.info" });
	assert.equal(info.ready, true);
	const sessions = await requestControl(service.home, { method: "sessions.list", params: { open: true } });
	assert.ok(Array.isArray(sessions));
	const task = `Yonder Reboot Check ${randomUUID()}`;
	const state = {
		status: "pending-reboot",
		task,
		home: service.home,
		install: service.install,
		beforeBoot: await boot(),
		beforePid: info.pid,
		sessions: sessions.map((s) => s.id),
		version: info.version,
		commit: info.commit,
		preparedAt: new Date().toISOString(),
	};
	await mkdir(dirname(report), { recursive: true });
	await writeFile(report, JSON.stringify(state, null, 2), { flag: "wx" });
	const args = `"${fileURLToPath(import.meta.url)}" check "${report}"`;
	await windowsCommand(
		`$u=[Security.Principal.WindowsIdentity]::GetCurrent().Name;$a=New-ScheduledTaskAction -Execute ${quote(process.execPath)} -Argument ${quote(args)};$t=New-ScheduledTaskTrigger -AtLogOn -User $u;$p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited;$s=New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries;Register-ScheduledTask -TaskName ${quote(task)} -Action $a -Trigger $t -Principal $p -Settings $s | Out-Null`,
	);
	console.log(JSON.stringify({ prepared: true, report, task, home: state.home, rebooted: false }));
} else {
	const state = JSON.parse(await readFile(report, "utf8"));
	if (action === "status") {
		console.log(JSON.stringify(state));
	} else if (action === "cleanup") {
		await windowsCommand(`Unregister-ScheduledTask -TaskName ${quote(state.task)} -Confirm:$false`);
		console.log("Removed only the acceptance reboot-check task; report retained");
	} else {
		let outcome;
		try {
			const afterBoot = await boot();
			assert.notEqual(afterBoot, state.beforeBoot, "No actual OS reboot detected");
			const end = Date.now() + 120000;
			let info, tray;
			while (Date.now() < end) {
				try {
					info = await requestControl(state.home, { method: "service.info" });
					tray = JSON.parse(await readFile(join(state.home, ".yonder/windows-tray.json"), "utf8"));
					if (info.ready && tray.started) {
						process.kill(tray.pid, 0);
						break;
					}
				} catch {}
				await sleep(500);
			}
			assert.equal(info?.ready, true);
			assert.equal(info.home, state.home);
			assert.equal(info.version, state.version);
			assert.equal(info.commit, state.commit);
			assert.equal(tray?.started, true);
			const sessions = await requestControl(state.home, { method: "sessions.list", params: { open: true } });
			assert.ok(Array.isArray(sessions));
			for (const id of state.sessions)
				assert.ok(
					sessions.some((s) => s.id === id),
					`Session ${id} was not recovered`,
				);
			outcome = {
				...state,
				status: "passed",
				afterBoot,
				service: { pid: info.pid, version: info.version, commit: info.commit },
				tray: { pid: tray.pid },
				sessionsReadable: Array.isArray(sessions),
				checkedAt: new Date().toISOString(),
			};
		} catch (error) {
			outcome = { ...state, status: "failed", error: error.message, checkedAt: new Date().toISOString() };
			process.exitCode = 1;
		}
		await writeFile(report, JSON.stringify(outcome, null, 2));
		if (outcome.status === "passed")
			await windowsCommand(`Unregister-ScheduledTask -TaskName ${quote(state.task)} -Confirm:$false`);
		console.log(JSON.stringify(outcome));
	}
}
