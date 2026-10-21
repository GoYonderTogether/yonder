// Migrated from AI-Being/plugins/wechat-archive; source: local wechat-context CLI.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
export async function source(cli: string, args: string[], signal: AbortSignal): Promise<Record<string, any>> {
	try {
		const { stdout } = await exec(cli, args, { signal, timeout: 65000, maxBuffer: 2 * 1024 * 1024 });
		const result = JSON.parse(stdout);
		if (result.ok !== true) throw new Error();
		return result;
	} catch {
		throw new Error("WECHAT_ARCHIVE_READ_FAILED");
	}
}
const within = (root: string, file: string) => {
	const rel = relative(root, file);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
export async function readWechatMediaFile(root: string, file: string, limit: number): Promise<Buffer> {
	const target = resolve(file);
	if (!isAbsolute(file) || !within(root, target)) throw Error("WECHAT_MEDIA_PATH_UNSAFE");
	const cache = await lstat(root);
	if (cache.isSymbolicLink() || !cache.isDirectory()) throw Error("WECHAT_MEDIA_PATH_UNSAFE");
	let current = root;
	const parts = relative(root, target).split(sep);
	for (let i = 0; i < parts.length; i++) {
		current = join(current, parts[i]!);
		const stat = await lstat(current);
		if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()))
			throw Error("WECHAT_MEDIA_PATH_UNSAFE");
	}
	const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
	if (!within(realRoot, realTarget)) throw Error("WECHAT_MEDIA_PATH_UNSAFE");
	const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) throw Error("WECHAT_MEDIA_PATH_UNSAFE");
		if (stat.size > limit) throw Error("WECHAT_MEDIA_ATTACHMENT_LIMIT");
		const bytes = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const extra = Buffer.alloc(1),
			more = await handle.read(extra, 0, 1, offset);
		if (offset !== stat.size || more.bytesRead || (await handle.stat()).size !== stat.size)
			throw Error("WECHAT_MEDIA_CHANGED");
		return bytes;
	} finally {
		await handle.close();
	}
}

// CLI normalization strips transport secrets; project only its public fields, never raw XML.
export function safeMessage(m: any, chat: string) {
	if (!m || !Number.isSafeInteger(m.id) || m.id < 1 || m.chat !== chat || typeof m.text !== "string")
		throw Error("WECHAT_ARCHIVE_INVALID");
	const n = m.normalized ?? {};
	return {
		id: m.id,
		chat,
		text: m.text.slice(0, 12000),
		timestamp: Number(m.timestamp) || null,
		sender: typeof m.sender === "string" ? m.sender : null,
		direction: ["incoming", "outgoing"].includes(m.direction) ? m.direction : "unknown",
		truncated: m.text.length > 12000 || m.truncated === true,
		media: { kind: typeof n.kind === "string" ? n.kind : "unknown", parsed: false },
		...(typeof n.url === "string" ? { url: n.url } : {}),
	};
}
