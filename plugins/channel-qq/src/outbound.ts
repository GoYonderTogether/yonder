import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MediaFileType, type ReplyTarget } from "@tencent-connect/qqbot-nodejs";
import { type Attachment, parseRef } from "@yonder/sdk";

export function recipient(id: string, target: string): ReplyTarget {
	const parsed = parseRef(target);
	if ((parsed.kind !== "conv" && parsed.kind !== "acct") || parsed.channel !== id)
		throw new Error("QQ target belongs to another instance");
	if (parsed.kind === "acct") {
		if (!/^[A-Za-z0-9_-]+$/.test(parsed.id)) throw new Error("Invalid QQ OpenID");
		return { scope: "c2c", targetId: parsed.id };
	}
	const match = /^(c2c|group):([A-Za-z0-9_-]+)$/.exec(parsed.id);
	if (!match) throw new Error("QQ conversation must include c2c: or group: and its OpenID");
	return { scope: match[1] as "c2c" | "group", targetId: String(match[2]) };
}

/** Outbound media either goes to the platform as an https URL or is uploaded from an allowlisted local file. */
export interface OutboundMedia {
	fileType: MediaFileType;
	source: { url: string } | { localPath: string };
}
/** A skipped attachment: `reason` is a readable, actionable line for the owner and the log. */
export type MediaResolution = { ok: true; media: OutboundMedia } | { ok: false; reason: string };

const fileTypeOf = (attachment: Attachment): MediaFileType =>
	attachment.kind === "image"
		? MediaFileType.IMAGE
		: attachment.kind === "audio"
			? MediaFileType.VOICE
			: attachment.kind === "video"
				? MediaFileType.VIDEO
				: MediaFileType.FILE;

/** `~/…` and `~` mean the home directory of this harness process, never a guess. */
const expandHome = (uri: string, home: string) =>
	uri === "~" ? home : uri.startsWith("~/") ? join(home, uri.slice(2)) : uri;

/**
 * Attachment references arrive as https URLs, `file:` URIs, `~/…` or home-relative paths, or absolute paths.
 * Everything local is resolved to an absolute path first, then checked against the allowlisted media root;
 * a reference that cannot be resolved is reported instead of thrown, so one bad attachment never drops the text.
 */
export function mediaOf(attachment: Attachment, root: string, home = homedir()): MediaResolution {
	const fileType = fileTypeOf(attachment);
	const uri = attachment.uri.trim();
	if (uri.startsWith("https://")) return { ok: true, media: { fileType, source: { url: uri } } };
	let path: string;
	if (uri.startsWith("file:")) {
		try {
			path = fileURLToPath(uri);
		} catch {
			return { ok: false, reason: `无法解析的 file 引用 ${uri}；请改用 https 链接或本机文件路径` };
		}
	} else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(uri)) {
		return { ok: false, reason: `只支持 https 链接：${uri}` };
	} else path = resolve(home, expandHome(uri, home));
	const rel = relative(resolve(root), resolve(path));
	if (rel.startsWith("..") || isAbsolute(rel))
		return { ok: false, reason: `本机文件不在允许的目录 ${root} 内：${path}` };
	return { ok: true, media: { fileType, source: { localPath: resolve(path) } } };
}

/** Rejects a resolved local media path whose realpath leaves the allowlisted root, or that does not exist. */
export async function assertInsideMediaRoot(localPath: string, root: string): Promise<void> {
	const [realPath, realRoot] = await Promise.all([realpath(localPath), realpath(root)]);
	const rel = relative(realRoot, realPath);
	if (isAbsolute(rel) || rel === "" || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || rel === "..")
		throw new Error(`QQ local attachment escapes the allowlisted media root: ${localPath}`);
}
