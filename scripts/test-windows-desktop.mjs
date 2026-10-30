import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { desktop, stopChildren } from "../plugins/native-automation/dist/desktop.js";

if (process.platform !== "win32") throw new Error("Native Windows required");
const root = resolve(".yonder/windows-desktop-acceptance");
await mkdir(root, { recursive: true });
const title = `Yonder desktop acceptance ${randomUUID()}`;
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const stateFile = join(root, "form.json");
await rm(stateFile, { force: true });
const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$form=[Windows.Forms.Form]::new();$form.Text=${quote(title)};$form.Size=[Drawing.Size]::new(500,250);$form.StartPosition='CenterScreen';$form.TopMost=$true;$box=[Windows.Forms.TextBox]::new();$box.Name='acceptance-text';$box.AccessibleName='Acceptance text';$box.Location=[Drawing.Point]::new(20,20);$box.Width=420;$form.Controls.Add($box);$button=[Windows.Forms.Button]::new();$button.Text='Verify input';$button.Location=[Drawing.Point]::new(20,80);$button.Width=200;$form.Controls.Add($button);$script:clicks=0;function Save{[IO.File]::WriteAllText(${quote(stateFile)},(@{text=$box.Text;clicks=$script:clicks}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))};$box.Add_TextChanged({Save});$button.Add_Click({$script:clicks++;Save});$form.Add_Shown({$form.Activate();$box.Focus();Save});[Windows.Forms.Application]::Run($form)`;
const child = spawn(
	join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
	["-NoProfile", "-STA", "-EncodedCommand", Buffer.from(code, "utf16le").toString("base64")],
	{ windowsHide: false, stdio: "ignore" },
);
const signal = () => AbortSignal.timeout(30000);
const call = (args) => desktop(args, signal(), "windows-acceptance");
async function formState(check) {
	const end = Date.now() + 10000;
	while (Date.now() < end) {
		try {
			const s = JSON.parse(await readFile(stateFile, "utf8"));
			if (check(s)) return s;
		} catch {}
		await sleep(50);
	}
	throw new Error("Form did not acknowledge input");
}
async function snapshot() {
	const s = await call({ action: "snapshot" });
	assert.equal(s.nodes[0].name, title, "Test window lost focus; stop without sending input");
	return s;
}
try {
	let state;
	for (let i = 0; i < 50; i++) {
		try {
			state = JSON.parse(await readFile(stateFile, "utf8"));
			break;
		} catch {
			await sleep(100);
		}
	}
	assert.ok(state, "Form not ready");
	let view = await snapshot();
	await call({ action: "screenshot", path: join(root, "initial.png") });
	const field =
		view.nodes.find((n) => n.role === "ControlType.Edit") ?? view.nodes.find((n) => n.depth === 1 && n.name === "");
	assert.ok(field, JSON.stringify(view));
	await call({ action: "click", x: Math.round(field.bounds.x + 20), y: Math.round(field.bounds.y + 10) });
	await snapshot();
	const value = `Windows Unicode 验证 🦤 ${randomUUID()}`;
	await call({ action: "type", text: value });
	await formState((s) => s.text === value);
	view = await snapshot();
	const button = view.nodes.find((n) => n.name === "Verify input");
	assert.ok(button);
	await call({ action: "click", x: Math.round(button.bounds.x + 20), y: Math.round(button.bounds.y + 10) });
	await formState((s) => s.clicks === 1);
	await snapshot();
	await call({ action: "key", keyCode: 9 });
	await call({ action: "screenshot", path: join(root, "desktop.png") });
	assert.deepEqual(
		(await readFile(join(root, "desktop.png"))).subarray(0, 8),
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	);
	const source = join(root, "source.bin"),
		out = join(root, `export-${randomUUID()}.bin`),
		bytes = randomBytes(4096);
	await writeFile(source, bytes);
	const listing = await call({ action: "file-list", path: root });
	assert.ok(listing.entries.some((e) => e.name === "source.bin"));
	await call({ action: "file-export", path: source, destination: out });
	assert.deepEqual(await readFile(out), bytes);
	await assert.rejects(call({ action: "file-export", path: source, destination: out }));
	const link = join(root, `link-${randomUUID()}`);
	await symlink(source, link);
	try {
		await assert.rejects(call({ action: "file-export", path: link, destination: join(root, "refused.bin") }));
	} finally {
		await rm(link, { force: true });
	}
	console.log(
		"PASS: actual WinForms/UIA snapshot, mouse click, Unicode+emoji SendInput, Virtual-Key, PNG, file list/export bytes, no-overwrite and symlink refusal",
	);
} finally {
	child.kill();
	await stopChildren("windows-acceptance");
}
