import { execFileSync } from "node:child_process";
import { windowsPowerShell } from "./windows-process.js";

/** Validate actual Windows ACLs; chmod's synthetic mode is not an authorization check. */
export function windowsCredentialAcl(path: string, create = false): void {
	const encoded = Buffer.from(path).toString("base64");
	const script = `$ErrorActionPreference='Stop'; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $f=[IO.FileInfo]::new($p); $a=$f.GetAccessControl(); ${create ? `$a.SetAccessRuleProtection($true,$false); foreach($r in @($a.Access)){$a.RemoveAccessRuleSpecific($r)}; $a.SetOwner($sid); $r=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'); $a.AddAccessRule($r); $f.SetAccessControl($a); $f=[IO.FileInfo]::new($p); $a=$f.GetAccessControl();` : ""} if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw 'Credential owner differs from current user'}; foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($sid.Value,'S-1-5-18','S-1-5-32-544')){throw 'Credential ACL grants another identity access'}}`;
	try {
		execFileSync(
			windowsPowerShell(),
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
			{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
		);
	} catch (cause) {
		throw new Error("Unsafe credential Windows ACL", { cause });
	}
}
