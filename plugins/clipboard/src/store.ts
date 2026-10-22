import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExecutionOwner } from "@yonder/sdk";
import { bounded, type Config, fail, sameOwner } from "./config.js";
import { Keychain } from "./keychain.js";
export const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export type Clip = ExecutionOwner & {
	id: string;
	class: "open" | "sealed";
	source: { type: string; ref: string };
	createdAt: string;
	expiresAt: string;
	byteLength: number;
	sha256: string;
};
export type Ticket = ExecutionOwner & { id: string; expiresAt: string; maxBytes: number };
export const idCheck = (id: string) => {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) fail("invalid_handle");
};
export async function writeNew(file: string, data: Buffer | string) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	const fd = await open(
		temporary,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await fd.writeFile(data);
		await fd.sync();
		await fd.close();
		// Atomic publication without overwrite, including concurrent one-use ticket claims.
		await link(temporary, file);
	} finally {
		await fd.close();
		await rm(temporary, { force: true });
	}
}
export async function safeRead(file: string, limit: number, start = 0, end?: number) {
	const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
	let data: Buffer | undefined;
	try {
		const s = await fd.stat(),
			stop = end ?? s.size;
		if (
			!s.isFile() ||
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(stop) ||
			start < 0 ||
			stop < start ||
			stop > s.size
		)
			return fail("invalid_file_range");
		if (stop - start > limit) return fail("source_too_large");
		data = Buffer.alloc(stop - start);
		let offset = 0;
		while (offset < data.length) {
			const { bytesRead } = await fd.read(data, offset, data.length - offset, start + offset);
			if (!bytesRead) return fail("source_changed_during_copy");
			offset += bytesRead;
		}
		return data;
	} catch (error) {
		data?.fill(0);
		throw error;
	} finally {
		await fd.close();
	}
}
export async function allowedPath(path: string, roots: string[], writing = false): Promise<string> {
	if (!path.startsWith("/") || path.includes("\0")) return fail("absolute_path_required");
	const normalized = resolve(path);
	const parent = await realpath(writing ? dirname(normalized) : normalized);
	// Reject aliases, including symlinks in intermediate directories.
	if (parent !== (writing ? dirname(normalized) : normalized)) return fail("symlink_path_denied");
	for (const root of roots) {
		const actual = await realpath(root);
		const delta = relative(actual, parent);
		if (delta !== ".." && !delta.startsWith(`..${sep}`) && !delta.startsWith(sep)) return normalized;
	}
	return fail("path_not_granted");
}
export class Store {
	readonly kernel: Keychain;
	constructor(
		readonly data: string,
		readonly config: Pick<Config, "maxBytes" | "ttlSeconds">,
	) {
		this.data = resolve(data);
		this.kernel = new Keychain(this.data);
	}
	async ensure() {
		for (const name of ["", "clips", "blobs", "tickets", "audit"]) {
			const path = join(this.data, name);
			await mkdir(path, { recursive: true, mode: 0o700 });
			const s = await lstat(path);
			if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0)
				fail("unsafe_data_directory");
		}
	}
	path(id: string, dir = "clips") {
		idCheck(id);
		return join(this.data, dir, `${id}.json`);
	}
	async all(): Promise<Clip[]> {
		let files: string[];
		try {
			files = await readdir(join(this.data, "clips"));
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw e;
		}
		const clips: Clip[] = [];
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const id = file.slice(0, -5);
			idCheck(id);
			const c = JSON.parse((await safeRead(this.path(id), 16384)).toString()) as Clip;
			if (
				c.id !== id ||
				!["open", "sealed"].includes(c.class) ||
				!/^[a-f0-9]{64}$/.test(c.sha256) ||
				!Number.isFinite(Date.parse(c.expiresAt)) ||
				!Number.isSafeInteger(c.byteLength) ||
				c.byteLength < 1 ||
				c.byteLength > 1048576
			)
				fail("invalid_clip_metadata");
			clips.push(c);
		}
		return clips;
	}
	async get(id: string, owner: ExecutionOwner, expired = false) {
		const c = (await this.all()).find((c) => c.id === id);
		if (!c || !sameOwner(c, owner)) return fail("handle_not_in_scope");
		if (!expired && Date.parse(c.expiresAt) <= Date.now()) return fail("handle_expired");
		return c;
	}
	ttl(seconds?: number) {
		return bounded(seconds, this.config.ttlSeconds, this.config.ttlSeconds);
	}
	async save(
		bytes: Buffer,
		kind: "open" | "sealed",
		owner: ExecutionOwner,
		source: Clip["source"],
		signal: AbortSignal,
		seconds?: number,
		id: string = randomUUID(),
	): Promise<Clip> {
		const ttl = this.ttl(seconds);
		if (!bytes.length || bytes.length > Math.min(this.config.maxBytes, kind === "sealed" ? 65536 : 1048576))
			return fail("source_too_large_or_empty");
		await this.ensure();
		signal.throwIfAborted();
		const clip: Clip = {
			...owner,
			id,
			class: kind,
			source,
			createdAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
			byteLength: bytes.length,
			sha256: hash(bytes),
		};
		let stored = false;
		try {
			if (kind === "sealed") {
				(await this.kernel.run("put", id, bytes, signal)).fill(0);
				stored = true;
			} else {
				const blob = join(this.data, "blobs", clip.sha256);
				try {
					await writeNew(blob, bytes);
				} catch (e) {
					if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
					const old = await safeRead(blob, this.config.maxBytes);
					try {
						if (hash(old) !== clip.sha256) fail("blob_hash_mismatch");
					} finally {
						old.fill(0);
					}
				}
			}
			signal.throwIfAborted();
			await writeNew(this.path(id), JSON.stringify(clip));
			return clip;
		} catch (e) {
			if (stored) (await this.kernel.run("drop", id, Buffer.alloc(0), AbortSignal.timeout(10000))).fill(0);
			throw e;
		}
	}
	async consume<T>(clip: Clip, signal: AbortSignal, fn: (data: Buffer) => Promise<T>): Promise<T> {
		const bytes =
			clip.class === "sealed"
				? await this.kernel.run("get", clip.id, Buffer.alloc(0), signal)
				: await safeRead(join(this.data, "blobs", clip.sha256), this.config.maxBytes);
		try {
			signal.throwIfAborted();
			if (bytes.length !== clip.byteLength || hash(bytes) !== clip.sha256) return fail("content_hash_mismatch");
			return await fn(bytes);
		} finally {
			bytes.fill(0);
		}
	}
	async drop(clip: Clip, signal: AbortSignal) {
		if (clip.class === "sealed") (await this.kernel.run("drop", clip.id, Buffer.alloc(0), signal)).fill(0);
		await rm(this.path(clip.id));
		// Shared content-addressed blobs are retained; no racy reference-count deletion.
	}
	async ticket(owner: ExecutionOwner, seconds?: number) {
		await this.ensure();
		const ticket: Ticket = {
			...owner,
			id: randomUUID(),
			expiresAt: new Date(Date.now() + this.ttl(seconds) * 1000).toISOString(),
			maxBytes: Math.min(this.config.maxBytes, 65536),
		};
		await writeNew(this.path(ticket.id, "tickets"), JSON.stringify(ticket));
		return ticket;
	}
	async journal(owner: ExecutionOwner, operation: string, phase: string, handle?: string) {
		await this.ensure();
		const id: string = randomUUID();
		await writeNew(
			join(this.data, "audit", `${id}.json`),
			JSON.stringify({
				auditId: id,
				ts: new Date().toISOString(),
				...owner,
				operation,
				phase,
				...(handle ? { handle } : {}),
			}),
		);
	}
	async redact(text: string, signal: AbortSignal) {
		// ponytail: linear scan of local sealed handles; index only when measured vault size requires it.
		let result = text,
			active = false;
		for (const clip of await this.all())
			if (clip.class === "sealed") {
				active = true;
				await this.consume(clip, signal, async (bytes) => {
					// Match raw text and JSON escaping; encoding/transformation is outside this defense.
					const value = bytes.toString("utf8");
					if (Buffer.from(value).equals(bytes) && value) {
						result = result.split(value).join("[sealed]");
						const escaped = JSON.stringify(value).slice(1, -1);
						if (escaped !== value) result = result.split(escaped).join("[sealed]");
					}
				});
			}
		return { text: result, active };
	}
}
