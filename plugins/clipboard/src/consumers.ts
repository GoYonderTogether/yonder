import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { privatePath } from "@yonder/sdk";
import { type Consumer, fail } from "./config.js";
import { hash } from "./store.js";
export function utf8(data: Buffer) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(data);
	} catch {
		return fail("destination_requires_utf8");
	}
}
export async function pasteFile(path: string, data: Buffer, signal: AbortSignal) {
	signal.throwIfAborted();
	const fd = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
	let done = false;
	try {
		privatePath(path, true);
		await fd.writeFile(data);
		await fd.sync();
		signal.throwIfAborted();
		const check = Buffer.alloc(data.length);
		try {
			const { bytesRead } = await fd.read(check, 0, check.length, 0);
			if (bytesRead !== data.length || hash(check) !== hash(data)) fail("destination_hash_mismatch");
		} finally {
			check.fill(0);
		}
		done = true;
		return { written: true, byteLength: data.length, sha256: hash(data) };
	} finally {
		await fd.close();
		if (!done) await rm(path, { force: true });
	}
}
export async function consume(config: Consumer, data: Buffer, signal: AbortSignal) {
	signal.throwIfAborted();
	if (config.kind === "http") {
		const headers: Record<string, string> = {};
		if (config.header) headers[config.header] = utf8(data);
		const response = await fetch(config.url, {
			method: config.method,
			headers,
			...(!config.header ? { body: new Uint8Array(data) } : {}),
			redirect: "error",
			signal,
		});
		await response.body?.cancel();
		return { ok: response.ok, status: response.status };
	}
	const value = utf8(data);
	if (value.includes("\0")) return fail("env_contains_nul");
	return new Promise<{ ok: boolean; exitCode: number | null }>((resolve, reject) => {
		// Only operator-configured executable/args, no shell and no inherited provider credentials.
		const child = spawn(config.file, config.args, {
			windowsHide: true,
			cwd: config.cwd,
			shell: false,
			stdio: "ignore",
			env: {
				...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}),
				PATH:
					process.platform === "win32"
						? join(process.env.SystemRoot ?? "C:\\Windows", "System32")
						: "/usr/bin:/bin:/usr/sbin:/sbin",
				[config.variable]: value,
			},
		});
		const cancel = () => child.kill("SIGKILL");
		signal.addEventListener("abort", cancel, { once: true });
		child.once("error", () => reject(new Error("consumer_start_failed")));
		child.once("close", (code) => {
			signal.removeEventListener("abort", cancel);
			if (signal.aborted) reject(new Error("consumer_cancelled_effect_unknown"));
			else resolve({ ok: code === 0, exitCode: code });
		});
	});
}
