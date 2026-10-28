import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { ToolContext } from "@yonder/sdk";
import { fromResult, toResult } from "./results.js";

export function cacheDirectory(home: string, session: string): string {
	if (!/^[0-9]+$/.test(session)) throw new Error("Invalid cache session");
	return join(home, "cache", "tool-output", session);
}

let pending = Promise.resolve();

export async function cacheToolOutput(
	home: string,
	session: string,
	tool: string,
	args: object,
	text: string,
	extension = "txt",
): Promise<string> {
	const operation = pending.then(() => save(home, session, tool, args, text, extension));
	pending = operation.then(
		() => undefined,
		() => undefined,
	);
	return operation;
}

async function save(home: string, session: string, tool: string, args: object, text: string, extension: string) {
	if (!/^[a-zA-Z0-9]{1,10}$/.test(extension)) throw new Error("Invalid cache extension");
	const dir = cacheDirectory(home, session);
	await mkdir(dir, { recursive: true, mode: 0o700 });
	const base = join(home, "cache", "tool-output");
	if ((await realpath(dir)) !== join(await realpath(base), session)) throw new Error("Invalid cache directory");
	const now = Date.now();
	let keepDays = 7;
	try {
		const config: unknown = JSON.parse(await readFile(join(home, "cache", "tool-output.json"), "utf8"));
		if (
			typeof config !== "object" ||
			config === null ||
			!("keepDays" in config) ||
			!Number.isSafeInteger(config.keepDays) ||
			(config.keepDays as number) < 1
		)
			throw new Error("tool-output.json keepDays must be a positive integer");
		keepDays = config.keepDays as number;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const cutoff = now - keepDays * 86400_000;
	for (const sessionDir of await readdir(base, { withFileTypes: true })) {
		if (!sessionDir.isDirectory() || !/^[0-9]+$/.test(sessionDir.name)) continue;
		const directory = join(base, sessionDir.name);
		const live = new Set<string>();
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (!entry.isFile() || entry.name === "index.jsonl") continue;
			const path = join(directory, entry.name);
			try {
				if ((await stat(path)).mtimeMs < cutoff) await rm(path, { force: true });
				else live.add(entry.name);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		const index = join(directory, "index.jsonl");
		try {
			const original = await readFile(index, "utf8");
			const kept = original.split("\n").filter((line) => {
				if (!line) return false;
				try {
					const record = JSON.parse(line) as { time: string; path: string };
					return Date.parse(record.time) >= cutoff && live.has(basename(record.path));
				} catch {
					return true;
				}
			});
			const next = kept.length ? `${kept.join("\n")}\n` : "";
			if (next !== original) {
				const temporary = `${index}.${randomUUID()}.tmp`;
				await writeFile(temporary, next, { mode: 0o600, flag: "wx" });
				await rename(temporary, index);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	const filename = tool.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "tool";
	const path = join(dir, `${filename}-${randomUUID()}.${extension}`);
	await writeFile(path, text, { mode: 0o600, flag: "wx" });
	try {
		await appendFile(
			join(dir, "index.jsonl"),
			`${JSON.stringify({ time: new Date(now).toISOString(), tool, args: Object.keys(args), bytes: Buffer.byteLength(text), path })}\n`,
			{ mode: 0o600 },
		);
	} catch (error) {
		await rm(path, { force: true });
		throw error;
	}
	return path;
}

export async function boundToolOutput(text: string, save: () => Promise<string>): Promise<string> {
	if (Buffer.byteLength(text) <= 50 * 1024 && text.split("\n").length <= 2000) return text;
	const path = await save();
	const hint = `Full output: ${path}. Use read to paginate or grep to search.\n`;
	const prefix = Buffer.from(text)
		.subarray(0, 48 * 1024)
		.toString("utf8")
		.replace(/\uFFFD$/, "");
	return hint + prefix.split("\n").slice(0, 1990).join("\n");
}

export function toolOutputWriter(ctx: ToolContext, tool: string, args: object, home: string) {
	return (text: string, options?: { extension?: string }) => {
		ctx.signal.throwIfAborted();
		return cacheToolOutput(home, ctx.session, tool, args, text, options?.extension);
	};
}

export async function cacheSdkResult(
	result: ToolExecutionResult,
	ctx: ToolContext,
	input: { name: string; args: object },
	options: { home: string; onReport?: ((error: unknown) => void) | undefined },
): Promise<ToolExecutionResult> {
	const value = fromResult(result);
	try {
		value.text = await boundToolOutput(value.text, () =>
			cacheToolOutput(options.home, ctx.session, input.name, input.args, value.text),
		);
	} catch {
		options.onReport?.(new Error("Tool output cache failed"));
		value.text = `Output cache failed; full output is unavailable.\n${value.text.slice(0, 4000)}`;
	}
	return toResult(value);
}
