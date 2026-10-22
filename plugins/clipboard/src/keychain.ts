import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ClipError, fail } from "./config.js";

/** Secrets never enter argv, errors or logs. Output is consumed only by trusted code. */
export function pipe(file: string, args: string[], input: Buffer, signal: AbortSignal, limit = 65536): Promise<Buffer> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, {
			shell: false,
			stdio: ["pipe", "pipe", "ignore"],
			env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME ?? "" },
		});
		const chunks: Buffer[] = [];
		let size = 0,
			failed = false;
		const cancel = () => {
			failed = true;
			child.kill("SIGKILL");
		};
		signal.addEventListener("abort", cancel, { once: true });
		const timer = setTimeout(cancel, 60000);
		child.stdout.on("data", (data: Buffer) => {
			size += data.length;
			if (size > limit) {
				data.fill(0);
				cancel();
			} else chunks.push(data);
		});
		child.stdin.on("error", () => {});
		child.on("error", () => {
			failed = true;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			signal.removeEventListener("abort", cancel);
			const output = Buffer.concat(chunks);
			for (const chunk of chunks) chunk.fill(0);
			if (failed || code !== 0 || signal.aborted) {
				output.fill(0);
				reject(
					new ClipError(
						code === 66 ? "kernel_item_missing" : code === 77 ? "kernel_locked_or_denied" : "kernel_failed",
					),
				);
			} else resolve(output);
		});
		child.stdin.end(input);
	});
}
export class Keychain {
	readonly helper: string;
	readonly service: string;
	constructor(readonly data: string) {
		this.helper = join(data, "keychain-helper");
		this.service = `org.goyonder.clipboard.${createHash("sha256").update(resolve(data)).digest("hex")}`;
	}
	async prepare(signal: AbortSignal) {
		if (process.platform !== "darwin") fail("macos_required");
		await mkdir(this.data, { recursive: true, mode: 0o700 });
		const info = await lstat(this.data);
		if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
			fail("unsafe_data_directory");
		try {
			const s = await lstat(this.helper);
			if (!s.isFile() || s.isSymbolicLink() || s.uid !== process.getuid?.() || (s.mode & 0o077) !== 0)
				fail("unsafe_helper");
			return;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}
		const temp = `${this.helper}.${randomUUID()}`;
		try {
			(
				await pipe(
					"/usr/bin/swiftc",
					[fileURLToPath(new URL("../native/keychain.swift", import.meta.url)), "-o", temp],
					Buffer.alloc(0),
					signal,
				)
			).fill(0);
			await chmod(temp, 0o700);
			await rename(temp, this.helper);
		} finally {
			await rm(temp, { force: true });
		}
	}
	async run(action: "put" | "get" | "drop", handle: string, input: Buffer, signal: AbortSignal) {
		if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(handle)) fail("invalid_handle");
		return pipe(this.helper, [action, this.service, handle], input, signal);
	}
}
