import { cp, lstat, mkdir, readFile, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { parseSkillFrontmatter } from "./index.js";

/** Caller resolves the selected agent and verifies its execution environment is local. */
export interface LocalSkillsTarget { home: string; workspace?: string }

async function managedRoot(target: LocalSkillsTarget, create: boolean): Promise<string> {
	const owner = await realpath(target.workspace ?? target.home);
	const root = join(owner, "skills");
	if (create) await mkdir(root, { recursive: true });
	const stat = await lstat(root);
	if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw new Error("skills 管理位置必须是本机直接目录，不能是符号链接");
	return root;
}

async function checkResources(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) throw new Error(`导入资源不能是符号链接：${join(directory, entry.name)}`);
		if (entry.isDirectory()) await checkResources(join(directory, entry.name));
		else if (!entry.isFile()) throw new Error(`导入资源必须是普通文件：${join(directory, entry.name)}`);
	}
}

export async function addLocalSkill(source: string, target: LocalSkillsTarget): Promise<{ name: string; directory: string; source: string }> {
	const origin = await realpath(resolve(source));
	if (!(await lstat(origin)).isDirectory()) throw new Error("导入来源必须是含 SKILL.md 的本机目录");
	const metadata = parseSkillFrontmatter(await readFile(join(origin, "SKILL.md"), "utf8"));
	await checkResources(origin);
	const root = await managedRoot(target, true);
	const directory = join(root, metadata.name);
	if (directory === origin || directory.startsWith(`${origin}${sep}`)) throw new Error("导入目标不能位于来源内");
	await mkdir(directory); // Exclusive claim: existing names are never overwritten.
	try {
		await cp(origin, directory, { recursive: true, force: false, errorOnExist: true, dereference: false });
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
	return { name: metadata.name, directory, source: origin };
}

export async function removeLocalSkill(name: string, target: LocalSkillsTarget): Promise<{ name: string; directory: string }> {
	if (name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("skill 名称无效");
	const root = await managedRoot(target, false);
	const directory = join(root, name);
	const stat = await lstat(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("只删除管理位置下的同名直接目录，不删除符号链接");
	const metadata = parseSkillFrontmatter(await readFile(join(directory, "SKILL.md"), "utf8"));
	if (metadata.name !== name) throw new Error("目录名与 SKILL.md name 不一致，拒绝删除");
	await rm(directory, { recursive: true }); // rm removes nested symlinks themselves, never their targets.
	return { name, directory };
}
