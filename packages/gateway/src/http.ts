import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, normalize, sep } from "node:path";

export const CSP = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
].join("; ");

export function baseHeaders(): Record<string, string> {
	return {
		"Content-Security-Policy": CSP,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		// same-origin, not no-referrer: with no-referrer browsers send `Origin: null` on the
		// login form POST, which the origin check (rightly) rejects.
		"Referrer-Policy": "same-origin",
		"X-Frame-Options": "DENY",
		"Cross-Origin-Resource-Policy": "same-origin",
		"X-Yonder-Protocol": "1",
	};
}

export function send(
	res: ServerResponse,
	status: number,
	body: string | Buffer,
	type: string,
	extra: Record<string, string | string[]> = {},
) {
	res.writeHead(status, { ...baseHeaders(), "Content-Type": type, ...extra });
	res.end(body);
}
export const sendJson = (
	res: ServerResponse,
	status: number,
	value: unknown,
	extra?: Record<string, string | string[]>,
) => send(res, status, JSON.stringify(value), "application/json; charset=utf-8", extra);
export const fail = (res: ServerResponse, status: number, code: string, message: string) =>
	sendJson(res, status, { ok: false, error: { code, message } });
export const redirect = (res: ServerResponse, location: string, extra: Record<string, string | string[]> = {}) =>
	send(res, 303, "", "text/plain", { Location: location, ...extra });

export class BodyError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}
export async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > max) throw new BodyError(413, "request body too large");
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

const types: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".wasm": "application/wasm",
};

const escapeAttr = (value: string) => value.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Serve a file from `root`; extension-less misses fall back to index.html (SPA). Returns false when nothing could be served. */
export async function serveStatic(
	res: ServerResponse,
	root: string,
	pathname: string,
	basePath: string,
): Promise<boolean> {
	let relative: string;
	try {
		relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
	} catch {
		return false;
	}
	if (relative.split(sep).includes("..")) return false;
	let file = join(root, relative || "index.html");
	let info = await stat(file).catch(() => undefined);
	if (info?.isDirectory()) {
		file = join(file, "index.html");
		info = await stat(file).catch(() => undefined);
	}
	if (!info?.isFile()) {
		if (extname(relative)) return false;
		file = join(root, "index.html");
		info = await stat(file).catch(() => undefined);
		if (!info?.isFile()) return false;
	}
	const type = types[extname(file).toLowerCase()] ?? "application/octet-stream";
	let body: string | Buffer = await readFile(file);
	if (file === join(root, "index.html")) {
		const tags = `<base href="${escapeAttr(basePath)}"><meta name="yonder-base-path" content="${escapeAttr(basePath)}">`;
		const html = body.toString("utf8");
		body = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${tags}`) : `${tags}${html}`;
	}
	const cache = file.endsWith(`${sep}index.html`)
		? "no-cache"
		: /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(basename(file))
			? "public, max-age=31536000, immutable"
			: "no-store";
	send(res, 200, body, type, { "Cache-Control": cache });
	return true;
}

export const loginPage = (basePath: string, message?: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yonder 登录</title>
<style>body{font:16px system-ui,sans-serif;max-width:24rem;margin:18vh auto;padding:0 1rem}
label,input,button{display:block;width:100%;box-sizing:border-box;margin-top:.6rem;font:inherit}
input,button{padding:.6rem}[role=alert]{color:#b00020}</style></head>
<body><main><h1>Yonder</h1>
<form method="post" action="${escapeAttr(basePath)}login">
<label for="token">访问令牌 · Access token</label>
<input id="token" name="token" type="password" autocomplete="current-password" required autofocus>
${message ? `<p role="alert">${escapeAttr(message)}</p>` : ""}
<button type="submit">登录 · Sign in</button></form></main></body></html>`;
