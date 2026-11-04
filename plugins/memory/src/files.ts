import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { PluginFiles } from "@yonder/sdk";
import { createFilePluginStorage } from "@yonder/sdk/node-storage";
import { parse } from "yaml";
import { within } from "./config.js";

export const directories = [
	"mine",
	"raw",
	"inbox",
	"life",
	"timeline",
	"me",
	"projects",
	"private",
	"archive",
	".memory",
];
export const schemaText = `# 记忆库读写规则

1. 事实优先于推断，confirmed 优先于 inferred；具体行为优先于抽象标签。
2. 档案里没有的不补写；冲突只标记，交用户裁决，不静默覆盖。
3. 优先级：当前任务与近况 > 具体经历 > 稳定价值观与偏好 > 兴趣标签 > 基础资料。
4. agent 来源的内容是假设，不是证据。派生断言须能追溯到记录或文件。
5. 整理只翻转标记、写去向，不改记录原文。mine/ 与登记目录只读。
`;
export function metadata(text: string): Record<string, unknown> {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
	if (!match) return {};
	const value: unknown = parse(match[1]!);
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export async function safePath(root: string, path: string): Promise<string> {
	if (isAbsolute(path)) throw new Error("Path must be relative to memory root");
	const base = await realpath(root);
	const target = join(base, path);
	if (!within(base, target)) throw new Error("Path outside memory root");
	// No symlink traversal, including links that point back inside the root.
	const parts = path.split(/[\\/]/);
	let current = base;
	for (const part of parts) {
		current = join(current, part);
		try {
			if ((await lstat(current)).isSymbolicLink()) throw new Error("Symbolic links are not allowed");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return target;
}
export type MemoryRoot = string | PluginFiles;
export const memoryFiles = (root: MemoryRoot): PluginFiles =>
	typeof root === "string" ? createFilePluginStorage(root).open(root) : root;

export async function createFile(root: MemoryRoot, path: string, text: string): Promise<boolean> {
	return memoryFiles(root).transaction(async (files) => {
		if ((await files.read(path)) !== undefined) return false;
		await files.write(path, text);
		return true;
	});
}
export async function initialize(root: MemoryRoot): Promise<void> {
	const files = memoryFiles(root);
	for (const dir of directories) await files.mkdir(dir);
	for (const [path, text] of Object.entries({
		"SCHEMA.md": schemaText,
		"log.md": "",
		"me/now.md": "## 当前\n## 历史\n",
		"me/profile.md": "## 当前\n## 历史\n",
		"me/mind.md": "## 当前\n## 历史\n",
		"life/vision.md": "## 愿景\n## 提议\n## 历史\n",
		".memory/manifest.json": "{}\n",
	}))
		await createFile(files, path, text);
}
export async function textFiles(root: MemoryRoot): Promise<string[]> {
	const files = memoryFiles(root);
	const found: string[] = [];
	async function walk(path: string) {
		for (const entry of await files.list(path)) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const child = path ? `${path}/${entry.name}` : entry.name;
			if (entry.type === "directory") await walk(child);
			else if (/\.(md|markdown|txt)$/i.test(entry.name)) found.push(child);
		}
	}
	await walk("");
	return found;
}
export async function readText(root: MemoryRoot, path: string): Promise<string> {
	const text = await memoryFiles(root).read(path);
	if (text === undefined) throw Object.assign(new Error(`No such memory file: ${path}`), { code: "ENOENT" });
	return text;
}
