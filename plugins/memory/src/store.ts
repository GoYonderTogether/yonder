import { createHash } from "node:crypto";
import { appendFile, lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import { safePath } from "./files.js";

// Shared by instances in this process, so all plugin callers serialize writes to the same canonical file.
const queues = new Map<string, Promise<unknown>>();
export async function serial<T>(path: string, run: () => Promise<T>): Promise<T> {
	const previous = queues.get(path) ?? Promise.resolve();
	const work = previous.catch(() => {}).then(run);
	queues.set(path, work);
	try {
		return await work;
	} finally {
		if (queues.get(path) === work) queues.delete(path);
	}
}
async function version(path: string): Promise<bigint | undefined> {
	try {
		return (await stat(path, { bigint: true })).mtimeNs;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
class Conflict extends Error {}

// The in-memory queue avoids lock churn for same-process callers; the lockfile
// coordinates separate plugin processes using the same root.
async function withFileLock<T>(root: string, file: string, run: () => Promise<T>): Promise<T> {
	const lockDir = await safePath(root, ".memory/locks");
	await mkdir(lockDir, { recursive: true });
	const lockPath = join(lockDir, `${createHash("sha256").update(file).digest("hex")}.lock`);
	try {
		await writeFile(lockPath, "", { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const release = await lockfile.lock(lockPath, {
		retries: { retries: 40, minTimeout: 25, maxTimeout: 250 },
		stale: 30_000,
	});
	try {
		if ((await lstat(lockPath)).isSymbolicLink()) throw new Error("Symbolic links are not allowed");
		return await run();
	} finally {
		await release();
	}
}
export interface WriteContext {
	op: string;
	id: string;
	by: string;
	session: string;
	signal: AbortSignal;
}
export class Store {
	constructor(readonly root: string) {}
	private async target(path: string): Promise<string> {
		if (process.platform === "win32") path = path.replaceAll("\\", "/");
		if (path === "mine" || path.startsWith("mine/")) throw new Error("mine is read-only");
		return safePath(this.root, path);
	}
	private async change(
		file: string,
		transform: (text: string | undefined) => string | Promise<string>,
		signal: AbortSignal,
	) {
		for (let attempt = 0; attempt < 2; attempt++) {
			signal.throwIfAborted();
			const before = await version(file);
			const old = before === undefined ? undefined : await readFile(file, "utf8");
			const next = await transform(old);
			if (next === old) return false;
			try {
				await writeFileAtomic(file, next, {
					tmpfileCreated: async () => {
						signal.throwIfAborted();
						if ((await version(file)) !== before) throw new Conflict("Concurrent edit");
					},
				});
				return true;
			} catch (error) {
				if (!(error instanceof Conflict)) throw error;
			}
		}
		throw new Error("Concurrent edit conflict after one retry; user changes preserved");
	}
	async log(path: string, ctx: WriteContext) {
		const file = await this.target("log.md");
		await serial(file, () =>
			withFileLock(this.root, file, async () => {
				ctx.signal.throwIfAborted();
				await this.target("log.md");
				await appendFile(
					file,
					`${new Date().toISOString()} ${ctx.op} ${path} ${ctx.id} by ${ctx.by} session:${ctx.session}\n`,
					{ flag: "a" },
				);
			}),
		);
	}
	async edit(path: string, transform: (text: string | undefined) => string | Promise<string>, ctx: WriteContext) {
		const file = await this.target(path);
		await mkdir(dirname(file), { recursive: true });
		return serial(file, () =>
			withFileLock(this.root, file, async () => {
				await this.target(path);
				await mkdir(dirname(file), { recursive: true });
				if (await this.change(file, transform, ctx.signal)) await this.log(path, ctx);
			}),
		);
	}
	async ensure(path: string, template: string, ctx: WriteContext) {
		await this.edit(path, (text) => text ?? template, ctx);
	}
	async append(path: string, template: string, block: (text: string) => string, ctx: WriteContext) {
		const file = await this.target(path);
		await mkdir(dirname(file), { recursive: true });
		await serial(file, () =>
			withFileLock(this.root, file, async () => {
				await this.target(path);
				await mkdir(dirname(file), { recursive: true });
				if (await this.change(file, (text) => text ?? template, ctx.signal)) await this.log(path, ctx);
				const old = await readFile(file, "utf8");
				ctx.signal.throwIfAborted();
				await appendFile(file, `${old.endsWith("\n") ? "" : "\n"}${block(old)}`, { flag: "a" });
				await this.log(path, ctx);
			}),
		);
	}
}
