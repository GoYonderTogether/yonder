import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Check a private local path using OS ownership/ACLs, never Windows' synthetic mode bits.
 * create is only for a newly created object, before writing confidential bytes.
 */
export function privatePath(path: string, create = false): void {
	const info = lstatSync(path);
	if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1))
		throw new Error("Unsafe private path");
	if (process.platform !== "win32") {
		if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
			throw new Error("Unsafe private path permissions");
		return;
	}
	let parent = resolve(path);
	while (true) {
		if (lstatSync(parent).isSymbolicLink()) throw new Error("Unsafe private path ancestor");
		const next = dirname(parent);
		if (next === parent) break;
		parent = next;
	}
	const encoded = Buffer.from(resolve(path)).toString("base64");
	const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $f=${info.isDirectory() ? "[IO.DirectoryInfo]" : "[IO.FileInfo]"}::new($p); $a=$f.GetAccessControl(); ${create ? `$a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)){$a.RemoveAccessRuleSpecific($r)}; $a.SetOwner($sid); $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl',${info.isDirectory() ? "'ContainerInherit,ObjectInherit','None'," : ""}'Allow')); $f.SetAccessControl($a); $a=$f.GetAccessControl();` : ""} if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Private path owner'}; foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'Private path ACL'}}`;
	try {
		execFileSync(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
			{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
		);
	} catch (cause) {
		throw new Error("Unsafe private path Windows ACL", { cause });
	}
}

/** Create-only local write: protect the empty object before confidential bytes enter it. */
export async function writePrivateFile(path: string, data: string | Uint8Array): Promise<void> {
	const file = await open(path, "wx", 0o600);
	let done = false;
	try {
		privatePath(path, true);
		await file.writeFile(data);
		await file.sync();
		done = true;
	} finally {
		await file.close();
		if (!done) await rm(path, { force: true });
	}
}
