import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privatePath } from "@yonder/sdk";
import { ClipError, fail } from "./config.js";

/** Secrets never enter argv, errors or logs. Output is consumed only by trusted code. */
export function pipe(file: string, args: string[], input: Buffer, signal: AbortSignal, limit = 65536): Promise<Buffer> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(file, args, {
			windowsHide: true,
			shell: false,
			stdio: ["pipe", "pipe", "ignore"],
			env:
				process.platform === "win32"
					? { SystemRoot: process.env.SystemRoot, USERPROFILE: process.env.USERPROFILE }
					: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: process.env.HOME ?? "" },
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
		if (process.platform === "win32") {
			signal.throwIfAborted();
			for (const path of [this.data, join(this.data, "kernel")]) {
				const created = await mkdir(path, { recursive: true });
				privatePath(path, created !== undefined);
			}
			return;
		}
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
		if (process.platform === "win32") {
			privatePath(this.data);
			privatePath(join(this.data, "kernel"));
			const path = join(this.data, "kernel", `${handle}.dpapi`);
			try {
				privatePath(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			const source = await readFile(new URL("../native/dpapi.ps1", import.meta.url), "utf8");
			const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
			const script = `& { ${source} } ${[action, this.service, path].map(quote).join(" ")}`;
			return pipe(
				join(process.env.SystemRoot ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
				["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
				input,
				signal,
			);
		}
		return pipe(this.helper, [action, this.service, handle], input, signal);
	}
}
