import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginStorage } from "@yonder/sdk";
import { DateTime } from "luxon";
import type { Config } from "./config.js";
import { memoryFiles, metadata, readText, textFiles } from "./files.js";
import { records } from "./records.js";

const exec = promisify(execFile);
export async function ready(path: string) {
	try {
		await access(path);
		return { path, available: true };
	} catch (error) {
		return { path, available: false, error: (error as NodeJS.ErrnoException).code };
	}
}
export async function status(config: Config, signal: AbortSignal, errors: string[], storage?: PluginStorage) {
	const files = storage?.open(config.root) ?? memoryFiles(config.root);
	let rg: { available: boolean; version?: string; error?: string };
	try {
		if (!files.localRoot) throw new Error("Virtual memory uses literal document search");
		const result = await exec("rg", ["--version"], { signal });
		rg = { available: true, version: result.stdout.split("\n")[0] ?? "" };
	} catch {
		signal.throwIfAborted();
		rg = { available: false, error: "ripgrep (rg) unavailable in PATH; install rg and expose it to the service" };
	}
	const sources = await Promise.all(
		(config.roots ?? []).map(async (root) => ({
			...root,
			...(files.localRoot ? await ready(root.path) : { available: true, virtual: true }),
		})),
	);
	let inbox = 0,
		pending = 0,
		oldest: number | undefined;
	try {
		for (const e of await files.list("inbox"))
			if (e.type === "file" && !e.name.startsWith(".") && !/\.(part|crdownload|tmp)$/.test(e.name)) inbox++;
		for (const path of await textFiles(files)) {
			signal.throwIfAborted();
			if (!path.startsWith("timeline/")) continue;
			const text = await readText(files, path);
			if (metadata(text).private === true) continue;
			const range = String(metadata(text).range ?? "").split("..")[0];
			for (const entry of records(text, range || undefined)) {
				if (entry.done) continue;
				pending++;
				const time = entry.date
					? DateTime.fromISO(`${entry.date}T${entry.time}`, { zone: config.timezone }).toMillis()
					: (await files.stat(path))!.mtimeMs;
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
			cli: files.localRoot
				? await ready(config.sources?.wechat?.cliPath ?? join(homedir(), ".local/bin/wechat-context"))
				: { available: false, error: "WeChat archive requires an available local or connected device environment" },
		},
		converter: config.converter
			? files.localRoot
				? await ready(config.converter.command)
				: { available: false, error: "Converter requires an available local or connected device environment" }
			: { configured: false },
		rg,
		inbox,
		unorganized: pending,
		oldestAgeDays: oldest === undefined ? null : Math.max(0, (Date.now() - oldest) / 86400000),
		recentErrors: errors,
	};
}
