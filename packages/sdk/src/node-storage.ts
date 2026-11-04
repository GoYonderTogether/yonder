import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import lockfile from "proper-lockfile";
import type { PluginFiles, PluginStorage } from "./plugin-storage.js";

const queues = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
	const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
	queues.set(key, result);
	try {
		return await result;
	} finally {
		if (queues.get(key) === result) queues.delete(key);
	}
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const kind = Symbol("directory");
type Change = string | null | typeof kind;

async function atomic(path: string, text: string | Uint8Array, mode = 0o600): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, text, { mode });
		for (let attempt = 0; ; attempt++) {
			try {
				await rename(temporary, path);
				return;
			} catch (error) {
				if (
					process.platform !== "win32" ||
					!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") ||
					attempt >= 5
				)
					throw error;
				await delay(20 * 2 ** attempt);
			}
		}
	} finally {
		await rm(temporary, { force: true });
	}
}

function fileTree(directory: string, preserveMode: boolean) {
	const root = resolve(directory);
	const journalName = ".yonder-storage-transaction.json";
	const journal = join(root, journalName);
	async function target(path: string) {
		if (isAbsolute(path)) throw new Error("Plugin file path must be relative");
		const result = resolve(root, path);
		const rel = relative(root, result);
		if (rel === journalName) throw new Error("Reserved plugin storage metadata path");
		if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
			throw new Error("Plugin file path escapes storage root");
		let current = root;
		for (const part of rel.split(sep).filter(Boolean)) {
			current = join(current, part);
			try {
				if ((await lstat(current)).isSymbolicLink())
					throw new Error("Symbolic links are not allowed in plugin storage");
			} catch (error) {
				if (!missing(error)) throw error;
			}
		}
		return result;
	}
	const rawRead = async (path: string) => {
		try {
			return await readFile(await target(path), "utf8");
		} catch (error) {
			if (missing(error)) return undefined;
			throw error;
		}
	};
	async function hasJournal() {
		try {
			if ((await lstat(journal)).isSymbolicLink()) throw new Error("Symbolic links are not allowed in plugin storage");
			return true;
		} catch (error) {
			if (missing(error)) return false;
			throw error;
		}
	}
	async function recover() {
		if (!(await hasJournal())) return;
		const pending = JSON.parse(await readFile(journal, "utf8")) as Array<{
			path: string;
			content: string | null;
			next: string | null;
			mode: number;
		}>;
		for (const old of pending) {
			const current = await rawRead(old.path);
			if (current !== (old.content ?? undefined) && current !== (old.next ?? undefined))
				throw new Error(`Plugin storage recovery conflict at ${old.path}; later user edits preserved`);
		}
		for (const old of pending) {
			if ((await rawRead(old.path)) === (old.content ?? undefined)) continue;
			const file = await target(old.path);
			if (old.content === null) await rm(file, { force: true });
			else await atomic(file, old.content, old.mode);
		}
		await rm(journal, { force: true });
	}
	function handle(staged?: Map<string, Change>, before?: Map<string, string | undefined>): PluginFiles {
		const key = (path: string) => relative(root, resolve(root, path));
		const remember = async (path: string) => {
			if (before && !before.has(path)) before.set(path, await rawRead(path));
		};
		const files: PluginFiles = {
			localRoot: root,
			async read(path) {
				if (!staged && (await hasJournal())) await files.transaction(async () => {});
				await target(path);
				path = key(path);
				const value = staged?.get(path);
				if (value === null) return undefined;
				if (value === kind) throw new Error("Path is a directory");
				if (value !== undefined) return value;
				const text = await rawRead(path);
				if (before && !before.has(path)) before.set(path, text);
				return text;
			},
			async write(path, text) {
				await target(path);
				path = key(path);
				if (!path) throw new Error("Plugin file path is required");
				if (!staged) return files.transaction((tx) => tx.write(path, text));
				await remember(path);
				staged.set(path, text);
			},
			async append(path, text) {
				await files.transaction(async (tx) => {
					await tx.write(path, ((await tx.read(path)) ?? "") + text);
				});
			},
			async list(path = "") {
				if (!staged && (await hasJournal())) await files.transaction(async () => {});
				const base = await target(path);
				const entries = new Map<string, "file" | "directory">();
				try {
					for (const entry of await readdir(base, { withFileTypes: true }))
						if (entry.isFile() || entry.isDirectory())
							entries.set(entry.name, entry.isDirectory() ? "directory" : "file");
				} catch (error) {
					if (!missing(error)) throw error;
				}
				const prefix = key(path);
				const head = prefix ? `${prefix}${sep}` : "";
				for (const [name, value] of staged ?? []) {
					if (!name.startsWith(head) || name === prefix) continue;
					const tail = name.slice(head.length);
					const first = tail.split(sep)[0]!;
					if (value === null && !tail.includes(sep)) entries.delete(first);
					else if (value !== null) entries.set(first, tail.includes(sep) || value === kind ? "directory" : "file");
				}
				return [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, type]) => ({ name, type }));
			},
			async stat(path) {
				if (!staged && (await hasJournal())) await files.transaction(async () => {});
				const file = await target(path);
				const value = staged?.get(key(path));
				if (value === null) return undefined;
				if (value !== undefined)
					return {
						type: value === kind ? "directory" : "file",
						size: value === kind ? 0 : Buffer.byteLength(value),
						mtimeMs: Date.now(),
					};
				try {
					const info = await stat(file);
					return { type: info.isDirectory() ? "directory" : "file", size: info.size, mtimeMs: info.mtimeMs };
				} catch (error) {
					if (missing(error)) return undefined;
					throw error;
				}
			},
			async mkdir(path) {
				await target(path);
				path = key(path);
				if (!staged) return files.transaction((tx) => tx.mkdir(path));
				if (path) staged.set(path, kind);
			},
			async remove(path) {
				await target(path);
				path = key(path);
				if (!path) throw new Error("Cannot remove plugin storage root");
				if (!staged) return files.transaction((tx) => tx.remove(path));
				await remember(path);
				staged.set(path, null);
			},
			async transaction<T>(change: (tx: PluginFiles) => Promise<T>): Promise<T> {
				if (staged) return change(files);
				await mkdir(root, { recursive: true, mode: 0o700 });
				const canonical = await realpath(root);
				return serial(canonical, async () => {
					const release = await lockfile.lock(canonical, {
						realpath: false,
						retries: { retries: 40, minTimeout: 25, maxTimeout: 250 },
						stale: 30000,
					});
					try {
						await recover();
						const changes = new Map<string, Change>();
						const originals = new Map<string, string | undefined>();
						const result = await change(handle(changes, originals));
						for (const [path, content] of originals)
							if ((await rawRead(path)) !== content)
								throw new Error("Concurrent edit conflict; user changes preserved");
						const undo: Array<{ path: string; content: string | null; next: string | null; mode: number }> = [];
						for (const [path, value] of changes)
							if (value !== kind) {
								let mode = 0o600;
								if (preserveMode) {
									try {
										mode = (await stat(await target(path))).mode & 0o777;
									} catch (error) {
										if (!missing(error)) throw error;
									}
								}
								undo.push({ path, content: originals.get(path) ?? null, next: value, mode });
							}
						if (undo.length) await atomic(journal, JSON.stringify(undo));
						try {
							for (const [path, content] of changes) {
								const file = await target(path);
								if (content === kind) {
									await mkdir(file, { recursive: true, mode: 0o700 });
									continue;
								}
								if (content === null) await rm(file, { force: true });
								else {
									let mode = 0o600;
									if (preserveMode) {
										try {
											mode = (await stat(file)).mode & 0o777;
										} catch (error) {
											if (!missing(error)) throw error;
										}
									}
									await atomic(file, content, mode);
								}
							}
						} catch (error) {
							await recover();
							throw error;
						}
						if (undo.length) await rm(journal, { force: true });
						return result;
					} finally {
						await release();
					}
				});
			},
		};
		return files;
	}
	return {
		files: handle(),
		async writeAttachment(path: string, bytes: Uint8Array) {
			const file = await target(path);
			await atomic(file, bytes);
			return pathToFileURL(file).href;
		},
	};
}

export function createFilePluginStorage(dataDirectory: string): PluginStorage {
	const opened = new Map<string, ReturnType<typeof fileTree>>();
	function tree(root?: string) {
		const path = resolve(root ?? dataDirectory);
		let value = opened.get(path);
		if (!value) {
			value = fileTree(path, root !== undefined);
			opened.set(path, value);
		}
		return value;
	}
	return {
		open: (root) => tree(root).files,
		writeAttachment: (path, bytes, _mime) => tree().writeAttachment(path, bytes),
	};
}
