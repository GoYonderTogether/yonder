import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext, ToolResult } from "@yonder/sdk";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { stopChildren } from "./desktop.js";
import { shrinkForModel } from "./image-size.js";

export type BrowserSession = { browser: Browser; context: BrowserContext; page: Page; tail: Promise<void> };
/** Shared plugin state; both tool groups own sessions in the same process. */
export interface Automation {
	artifacts: string;
	sessions: Map<string, Promise<BrowserSession>>;
	closed: Set<string>;
	stopping: boolean;
}
export function requireField<T>(value: T | undefined, name: string): T {
	if (value === undefined) throw new Error(`${name} is required for this action`);
	return value;
}
export function result(value: unknown): ToolResult {
	return { text: JSON.stringify(value) };
}
export async function closeSession(state: Automation, session: string) {
	const existing = state.sessions.get(session);
	state.sessions.delete(session);
	await stopChildren(session);
	if (existing) await existing.then((s) => s.browser.close()).catch(() => {});
}
export function check(state: Automation, ctx: ToolContext, capabilities: string[]) {
	ctx.signal.throwIfAborted();
	if (state.stopping || state.closed.has(ctx.session)) throw new Error("Automation plugin/session stopping");
	if (ctx.env.id !== "node:local") throw new Error("Native automation supports node:local only");
	if (capabilities.some((c) => !ctx.capabilities.includes(c as (typeof ctx.capabilities)[number])))
		throw new Error(`Requires ${capabilities.join(", ")}`);
}
export async function image(state: Automation, buffer: Buffer, source: string): Promise<ToolResult> {
	if (buffer.byteLength > 20 * 1024 * 1024) throw new Error("Screenshot exceeds 20MB; use viewport capture");
	await mkdir(state.artifacts, { recursive: true });
	const path = join(state.artifacts, `${randomUUID()}.png`);
	await writeFile(path, buffer, { mode: 0o600 });
	// 先在本机缩小再交给内核：原图仍留在 artifact 目录，进模型的是一份小得多的 JPEG。
	const shrunk = await shrinkForModel(path);
	return {
		text: JSON.stringify({
			source,
			path: shrunk.path,
			bytes: shrunk.bytes.byteLength,
			mime: shrunk.mime,
			originalPath: shrunk.path === path ? undefined : path,
			originalBytes: shrunk.original,
		}),
		images: [{ mime: shrunk.mime, data: shrunk.bytes.toString("base64") }],
	};
}
