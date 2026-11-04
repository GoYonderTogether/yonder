import type { Context } from "@earendil-works/chord";
import type { JsonObject } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { anchorOwners } from "@earendil-works/pi-durable/tools";
import type { Capability, ExecutionEnv, ToolContext } from "@yonder/sdk";
import type { RuntimeSessionConfig } from "./types.js";

const separator = (path: string) => (path.includes("\\") || /^[a-z]:/i.test(path) ? "\\" : "/");
const isAbsolute = (path: string) => path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\");
const join = (...parts: string[]) => {
	const sep = separator(parts[0] ?? "");
	return parts.map((part, index) => (index ? part.replace(/^[\\/]+/, "") : part.replace(/[\\/]+$/, ""))).join(sep);
};
const relative = (root: string, target: string) => {
	const sep = separator(root);
	const fold = (value: string) => (sep === "\\" ? value.toLowerCase() : value);
	const base = fold(root.replace(/[\\/]+$/, ""));
	const path = fold(target.replace(/[\\/]+$/, ""));
	if (path === base) return "";
	if (path.startsWith(`${base}${sep}`))
		return target.replace(/[\\/]+$/, "").slice(root.replace(/[\\/]+$/, "").length + 1);
	return isAbsolute(target) ? (sep === "\\" ? "..\\outside" : "../outside") : target;
};
const dirname = (path: string) => {
	const sep = separator(path);
	const index = path.lastIndexOf(sep);
	return index <= 0 ? path.slice(0, 1) || "." : path.slice(0, index);
};
const cacheDirectory = (home: string, session: string) => join(home, "cache", "tool-output", session);

export interface PolicyDeps {
	home: string;
	capabilities: Map<string, Capability[]>;
	environment(config: RuntimeSessionConfig): ExecutionEnv;
	context(session: string, context: Context): Promise<ToolContext>;
	fileURLToPath?(uri: string): string;
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
		if (
			config.resources?.length &&
			!config.resources.some((resource) => resource.deviceId === "local") &&
			config.resolved.env === "local" &&
			[
				"bash",
				"process",
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
			].includes(name)
		)
			return "当前工作区只选择了远程设备；使用 devices 工具在已选择设备上执行，不能在运行宿主执行本地工具。";
		if (name === "bash" && typeof args.cwd === "string")
			return this.deniedPath(name, args.cwd, config, context, session);
		if (
			config.resources?.length &&
			!config.resources.some((resource) => resource.deviceId === "local") &&
			(this.deps.capabilities.get(name) ?? []).includes("exec") &&
			!["bash", "process"].includes(name) &&
			!name.startsWith("devices_")
		)
			return "此工具需要运行宿主；本次资源只授权了远程设备。";
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
		const roots = config.resources?.find(
			(resource) => resource.deviceId === (env.id.startsWith("device:") ? env.id.slice(7) : "local"),
		)?.paths;
		if (roots?.length) {
			const allowed = (await Promise.all(roots.map(canonical))).some((root) => {
				const rel = relative(root, target);
				return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${separator(rel)}`);
			});
			if (
				!allowed &&
				!((name === "read" || name === "grep") && (await this.attachmentPaths(session, context)).includes(target))
			)
				return "文件路径不在本次选择的工作目录内。";
		}
		if (env.id === "node:local" && (name === "read" || name === "grep")) {
			const base = await canonical(join(this.deps.home, "cache", "tool-output"));
			const rel = relative(base, target);
			if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${separator(rel)}`)) {
				const own = await canonical(cacheDirectory(this.deps.home, session));
				const ownRel = relative(own, target);
				if (isAbsolute(ownRel) || ownRel === ".." || ownRel.startsWith(`..${separator(ownRel)}`))
					return "缓存路径超出当前会话。";
			}
		}
		if (!config.resolved.capabilities.includes("exec") && !roots?.length && env.id === "node:local") {
			const rel = relative(cwd, target);
			if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${separator(rel)}`)) {
				const ctx = await this.attachmentPaths(session, context);
				const cache = await canonical(cacheDirectory(this.deps.home, session));
				const base = await canonical(join(this.deps.home, "cache", "tool-output"));
				const cacheRel = relative(cache, target);
				const inCache =
					relative(base, cache) === session &&
					!isAbsolute(cacheRel) &&
					cacheRel !== ".." &&
					!cacheRel.startsWith(`..${separator(cacheRel)}`);
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
			const path = attachment.uri.startsWith("file:")
				? (this.deps.fileURLToPath?.(attachment.uri) ?? decodeURIComponent(new URL(attachment.uri).pathname))
				: attachment.uri;
			if (!isAbsolute(path)) continue;
			const canonical = await ctx.env.canonicalPath(path, context);
			if (canonical.ok) paths.push(canonical.value);
		}
		return paths;
	}
}
