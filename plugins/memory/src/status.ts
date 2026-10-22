import { execFile } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Config } from "./config.js";
import { metadata, readText, safePath, textFiles } from "./files.js";

const exec = promisify(execFile);
export async function ready(path: string) {
	try {
		await access(path);
		return { path, available: true };
	} catch (error) {
		return { path, available: false, error: (error as NodeJS.ErrnoException).code };
	}
}
export async function status(config: Config, signal: AbortSignal, errors: string[]) {
	let rg: { available: boolean; version?: string; error?: string };
	try {
		const result = await exec("rg", ["--version"], { signal });
		rg = { available: true, version: result.stdout.split("\n")[0] ?? "" };
	} catch {
		signal.throwIfAborted();
		rg = { available: false, error: "ripgrep (rg) unavailable in PATH; install rg and expose it to the service" };
	}
	const sources = await Promise.all(
		(config.roots ?? []).map(async (root) => ({ ...root, ...(await ready(root.path)) })),
	);
	let inbox = 0,
		pending = 0,
		oldest: number | undefined;
	try {
		for (const e of await readdir(await safePath(config.root, "inbox"), { withFileTypes: true }))
			if (e.isFile() && !e.name.startsWith(".") && !/\.(part|crdownload|tmp)$/.test(e.name)) inbox++;
		for (const path of await textFiles(config.root)) {
			signal.throwIfAborted();
			if (!path.startsWith("timeline/")) continue;
			const text = await readText(config.root, path);
			if (metadata(text).private === true) continue;
			for (const line of text.split("\n"))
				if (/^- \[ \] \d{2}:\d{2} \{[^}]+\}/.test(line)) {
					pending++;
					const id = /\^m([a-z0-9]+)[a-z0-9]{2}(?:\s|$)/.exec(line)?.[1];
					const time = id ? Number.parseInt(id, 36) : (await stat(await safePath(config.root, path))).mtimeMs;
					if (Number.isFinite(time)) oldest = Math.min(oldest ?? time, time);
				}
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return {
		root: config.root,
		schema: join(config.root, "SCHEMA.md"),
		sources,
		wechat: {
			configured: config.sources?.wechat?.chats ?? [],
			cli: await ready(config.sources?.wechat?.cliPath ?? join(homedir(), ".local/bin/wechat-context")),
		},
		converter: config.converter ? await ready(config.converter.command) : { configured: false },
		rg,
		inbox,
		unorganized: pending,
		oldestAgeDays: oldest === undefined ? null : Math.max(0, (Date.now() - oldest) / 86400000),
		recentErrors: errors,
	};
}
