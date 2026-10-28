import { join, posix, win32 } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ExecutionEnv } from "@yonder/sdk";

const names = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const maxBytes = 32 * 1024;
const maxTotalBytes = 128 * 1024;

export async function projectRules(
	env: ExecutionEnv,
	cwd: string,
	globalEnv: ExecutionEnv,
	globalDir: string,
	signal?: AbortSignal,
) {
	const context = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;
	const paths = /^[A-Za-z]:[\\/]/u.test(cwd) || cwd.startsWith("\\\\") ? win32 : posix;
	const directories: string[] = [];
	for (let current = cwd; ; current = paths.dirname(current)) {
		directories.unshift(current);
		if (paths.dirname(current) === current) break;
	}
	const seen = new Set<string>();
	const rules: { path: string; content: string }[] = [];
	let remaining = maxTotalBytes;
	for (const [source, directory, pathApi] of [
		[globalEnv, globalDir, { join }],
		...directories.map((dir) => [env, dir, paths] as const),
	] as const) {
		for (const name of names) {
			const path = pathApi.join(directory, name);
			const opened = await source.openBinaryReader(path, undefined, context);
			if (!opened.ok) {
				if (["not_found", "not_directory", "is_directory", "invalid"].includes(opened.error.code)) continue;
				throw opened.error;
			}
			try {
				const canonical = await source.canonicalPath(path, context);
				if (!canonical.ok) throw canonical.error;
				const key = `${source.id}:${canonical.value}`;
				if (seen.has(key)) break;
				seen.add(key);
				const info = await opened.value.info(context);
				if (!info.ok) throw info.error;
				const count = Math.min(maxBytes, remaining);
				const bytes = await opened.value.read(0, count, context);
				if (!bytes.ok) throw bytes.error;
				remaining -= bytes.value.length;
				const content = new TextDecoder().decode(bytes.value).replace(/^\uFEFF/u, "");
				rules.push({ path, content: content + (info.value.size > bytes.value.length ? "\n[truncated]" : "") });
				break;
			} finally {
				await opened.value.close(context);
			}
		}
		if (remaining === 0) break;
	}
	return rules;
}
