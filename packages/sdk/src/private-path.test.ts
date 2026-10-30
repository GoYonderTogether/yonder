import { execFileSync } from "node:child_process";
import { link, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { privatePath, writePrivateFile } from "./private-path.js";

test("private local files are protected before write and refuse overwrite, hardlinks and symlinks", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-private-path-")),
		file = join(root, "value"),
		alias = join(root, "alias"),
		sym = join(root, "sym");
	try {
		privatePath(root, true);
		await writePrivateFile(file, "actual private write");
		privatePath(file);
		await expect(writePrivateFile(file, "overwrite")).rejects.toThrow();
		expect(await readFile(file, "utf8")).toBe("actual private write");
		await link(file, alias);
		expect(() => privatePath(file)).toThrow();
		await rm(alias);
		await symlink(file, sym);
		expect(() => privatePath(sym)).toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test.skipIf(process.platform !== "win32")("actual Windows broad read ACL is rejected", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-private-acl-")),
		file = join(root, "value");
	try {
		await writePrivateFile(file, "ACL check");
		const p = Buffer.from(file).toString("base64");
		const source = `$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${p}'));$f=[IO.FileInfo]::new($p);$a=$f.GetAccessControl();$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),'Read','Allow'));$f.SetAccessControl($a)`;
		execFileSync(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
			["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")],
			{ windowsHide: true, stdio: "ignore" },
		);
		expect(() => privatePath(file)).toThrow("Windows ACL");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
