import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord";
import type { JsonObject } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { anchorOwners } from "@earendil-works/pi-durable/tools";
import type { Capability, ExecutionEnv, ToolContext } from "@yonder/sdk";
import { cacheDirectory } from "./tool-output-cache.js";
import type { RuntimeSessionConfig } from "./types.js";

export interface PolicyDeps {
	home: string;
	capabilities: Map<string, Capability[]>;
	environment(config: RuntimeSessionConfig): ExecutionEnv;
	context(session: string, context: Context): Promise<ToolContext>;
}

/**
 * The files a call touches: the one its `path` names, and every file whose anchors it quotes, because `copy` and
 * `move` reach a second file by anchor alone. Empty when nothing is known, so the edit itself reports the anchors
 * it cannot resolve.
 */
function checkedPaths(args: JsonObject): string[] {
	const paths = new Set<string>();
	if (typeof args.path === "string") paths.add(args.path);
	const fields = ["anchor", "remove_from", "remove_to", "replace_from", "replace_to", "source_from", "source_to"];
	for (const field of fields) {
		const value = args[field];
		if (typeof value !== "string") continue;
		for (const owner of anchorOwners(value)) paths.add(owner);
	}
	return [...paths];
}

/** Capability, workspace-boundary and protected-file checks applied before a tool runs. */
export class ToolPolicy {
	constructor(private deps: PolicyDeps) {}
	async denied(
		name: string,
		args: JsonObject,
		config: RuntimeSessionConfig,
		context: Context,
		session: string,
	): Promise<string | undefined> {
		const missing = (this.deps.capabilities.get(name) ?? []).filter((c) => !config.resolved.capabilities.includes(c));
		if (missing.length) return `缺少能力：${missing.join(", ")}`;
		if (name === "process" && args.action === "write" && !config.resolved.capabilities.includes("exec"))
			return "Writing process stdin requires exec capability";
		const guarded = [
			"read",
			"write",
			"edit",
			"replace",
			"replace_match",
			"insert",
			"copy",
			"move",
			"undo_last_change",
			"grep",
			"ls",
			"find",
		];
		if (!guarded.includes(name)) return;
		if ((name === "grep" || name === "ls" || name === "find") && args.path === undefined) args = { ...args, path: "." };
		for (const path of checkedPaths(args)) {
			const reason = await this.deniedPath(name, path, config, context, session);
			if (reason !== undefined) return reason;
		}
	}

	/** Checks one target path of a call; `denied` loops over every file its anchors name. */
	private async deniedPath(
		name: string,
		path: string,
		config: RuntimeSessionConfig,
		context: Context,
		session: string,
	): Promise<string | undefined> {
		const env = this.deps.environment(config);
		const canonical = async (path: string): Promise<string> => {
			const result = await env.canonicalPath(path, context);
			if (result.ok) return result.value;
			if (result.error.code !== "not_found") throw result.error;
			const absolute = getOrThrow(await env.absolutePath(path, context));
			const parent = dirname(absolute);
			if (parent === absolute) throw result.error;
			return getOrThrow(await env.joinPath([await canonical(parent), absolute.slice(parent.length)], context));
		};
		const target = await canonical(path),
			cwd = await canonical(config.cwd);
		if (env.id === "node:local" && (name === "read" || name === "grep")) {
			const base = await canonical(join(this.deps.home, "cache", "tool-output"));
			const rel = relative(base, target);
			if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
				const own = await canonical(cacheDirectory(this.deps.home, session));
				const ownRel = relative(own, target);
				if (
					isAbsolute(ownRel) ||
					ownRel === ".." ||
					ownRel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
				)
					return "缓存路径超出当前会话。";
			}
		}
		if (!config.resolved.capabilities.includes("exec")) {
			const rel = relative(cwd, target);
			if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
				const ctx = await this.attachmentPaths(session, context);
				const cache = await canonical(cacheDirectory(this.deps.home, session));
				const base = await canonical(join(this.deps.home, "cache", "tool-output"));
				const cacheRel = relative(cache, target);
				const inCache =
					relative(base, cache) === session &&
					!isAbsolute(cacheRel) &&
					cacheRel !== ".." &&
					!cacheRel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
				const allowed =
					(name === "read" || name === "grep") &&
					(ctx.some((a) => a === target) || (env.id === "node:local" && inCache));
				if (!allowed) return "文件路径超出当前工作区。";
			}
		}
		if (name !== "read" && name !== "grep" && name !== "ls" && name !== "find")
			for (const file of [{ path: "agent.yaml", capability: "admin" as const }, ...(config.protectedFiles ?? [])]) {
				const protectedPath = await canonical(getOrThrow(await env.joinPath([config.cwd, file.path], context)));
				if (target === protectedPath && !config.resolved.capabilities.includes(file.capability))
					return `受保护文件需要 ${file.capability} 能力。`;
			}
	}
	private async attachmentPaths(session: string, context: Context): Promise<string[]> {
		const ctx = await this.deps.context(session, context);
		const attachments = (ctx.events ?? (ctx.event ? [ctx.event] : [])).flatMap(
			(event) => (event.data as { attachments?: Array<{ uri: string }> }).attachments ?? [],
		);
		const paths: string[] = [];
		for (const attachment of attachments) {
			const path = attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri;
			if (!isAbsolute(path)) continue;
			const canonical = await ctx.env.canonicalPath(path, context);
			if (canonical.ok) paths.push(canonical.value);
		}
		return paths;
	}
}
