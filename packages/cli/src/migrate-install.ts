import { mkdir, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { JOURNAL, type MigrateOptions, probe, suffix } from "./migrate.js";

export async function planInstall(options: MigrateOptions, conflicts: string[]): Promise<boolean> {
	let installMoving = false;
	const { oldInstall, newInstall } = options;
	if (oldInstall && newInstall) {
		const oldInstallKind = await probe(oldInstall);
		const newInstallKind = await probe(newInstall);
		if (oldInstallKind === "dir" && newInstallKind === "absent") installMoving = true;
		else if (oldInstallKind === "symlink") {
			const target = await realpath(oldInstall).catch(() => undefined);
			if (!target || target !== (await realpath(newInstall).catch(() => undefined)))
				conflicts.push(`旧安装路径链接已被改动，请人工处理：${oldInstall}`);
		} else if (oldInstallKind !== "absent") conflicts.push(`安装路径冲突，请人工处理：${oldInstall} 与 ${newInstall}`);
		else if (newInstallKind !== "absent" && newInstallKind !== "dir")
			conflicts.push(`新安装路径不是目录：${newInstall}`);
	}
	return installMoving;
}

export async function moveInstall(
	options: MigrateOptions,
	undo: Array<() => Promise<void>>,
	scratch: string[],
	backup: string | undefined,
): Promise<void> {
	if (options.oldInstall && options.newInstall) {
		const oldInstall = options.oldInstall;
		const newInstall = options.newInstall;
		await mkdir(dirname(newInstall), { recursive: true });
		const tempLink = `${oldInstall}.migrate-${suffix()}`;
		scratch.push(tempLink);
		const journal = { version: 1, oldHome: oldInstall, newHome: newInstall, tempLink, backup };
		await writeFile(join(oldInstall, JOURNAL), `${JSON.stringify(journal)}\n`);
		undo.push(async () => {
			await rm(join((await probe(newInstall)) === "dir" ? newInstall : oldInstall, JOURNAL), { force: true });
		});
		await symlink(
			(options.platform ?? process.platform) === "win32" ? newInstall : relative(dirname(oldInstall), newInstall),
			tempLink,
			(options.platform ?? process.platform) === "win32" ? "junction" : "dir",
		);
		await rename(oldInstall, newInstall);
		undo.push(async () => {
			if ((await probe(oldInstall)) === "symlink") await unlink(oldInstall);
			await rename(newInstall, oldInstall);
		});
		await rename(tempLink, oldInstall);
	}
}
