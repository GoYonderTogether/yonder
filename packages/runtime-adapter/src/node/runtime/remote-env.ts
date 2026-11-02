import { createHash, randomUUID } from "node:crypto";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord";
import {
	type BinaryReader,
	type DirReader,
	type ExecutionEnv,
	ExecutionError,
	err,
	FileError,
	type FileInfo,
	getOrThrow,
	LineScanner,
	ok,
	type Result,
	type ShellExecOptions,
	type TextLineReader,
} from "@earendil-works/pi-durable/env";
import { localEnvironment } from "./env.js";
import type { RuntimeInternals } from "./instance.js";
import type { RuntimeSessionConfig } from "./types.js";

type Operation = (action: string, args: Record<string, unknown>, context: Context) => Promise<unknown>;
export function remoteEnvironment(rt: RuntimeInternals, config: RuntimeSessionConfig, deviceId: string): ExecutionEnv {
	const operation: Operation = async (action, args, context) => {
		if (!rt.options.deviceOperation) throw new Error("Device operations are unavailable");
		const invocation = rt.invocationConfigs.get(context);
		let commandId = randomUUID();
		if (invocation?.operationPrefix) {
			const hex = createHash("sha256")
				.update(`${invocation.operationPrefix}:${invocation.operationSequence++}`)
				.digest("hex");
			commandId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
		}
		return rt.options.deviceOperation(
			config,
			deviceId,
			commandId,
			action,
			args,
			context.abortSignal ?? new AbortController().signal,
		);
	};
	const remote = createRemoteEnvironment(deviceId, config.cwd, operation);
	const local = localEnvironment(rt.options.home);
	const reads = new Set([
		"canonicalPath",
		"absolutePath",
		"fileInfo",
		"readTextFile",
		"readTextLines",
		"readBinaryFile",
		"openBinaryReader",
		"openTextLineReader",
		"exists",
	]);
	return new Proxy(remote, {
		get(target, key) {
			const original = Reflect.get(target, key);
			if (typeof key !== "string" || !reads.has(key) || typeof original !== "function") return original;
			return (...args: unknown[]) => {
				const context = args.at(-1) as Context;
				const attachments = (rt.invocationConfigs.get(context)?.events ?? []).flatMap(
					(event) => (event.data as { attachments?: Array<{ uri: string }> }).attachments ?? [],
				);
				const path = args[0];
				const isAttachment = attachments.some(
					(attachment) =>
						attachment.uri === path || (attachment.uri.startsWith("file:") && fileURLToPath(attachment.uri) === path),
				);
				return Reflect.apply(isAttachment ? Reflect.get(local, key) : original, isAttachment ? local : target, args);
			};
		},
	});
}

/** Bounded remote files use one immutable in-memory read; the executor rejects files above 512 KiB. */
export function createRemoteEnvironment(deviceId: string, cwd: string, operation: Operation): ExecutionEnv {
	const pathApi = /^[A-Za-z]:[\\/]|^\\\\/.test(cwd) ? win32 : posix;
	const absolute = (path: string) => pathApi.resolve(cwd, path);
	const fileError = (error: unknown, path?: string) => {
		if (error instanceof FileError) return error;
		const value = error as { code?: string; message?: string; name?: string };
		const code =
			(
				{
					ENOENT: "not_found",
					EACCES: "permission_denied",
					EPERM: "permission_denied",
					UNAUTHORIZED: "permission_denied",
					ENOTDIR: "not_directory",
					EISDIR: "is_directory",
					EINVAL: "invalid",
					EFBIG: "invalid",
				} as const
			)[value.code as "ENOENT"] ?? (value.name === "AbortError" ? "aborted" : "unknown");
		return new FileError(code, value.message ?? String(error), path, error instanceof Error ? error : undefined);
	};
	async function call<T>(
		action: string,
		args: Record<string, unknown>,
		context: Context,
	): Promise<Result<T, FileError>> {
		try {
			context.abortSignal?.throwIfAborted();
			const value = (await operation(action, args, context)) as T & { error?: { code: string; message: string } };
			if (value?.error) throw value.error;
			return ok(value);
		} catch (error) {
			return err(fileError(error, args.path as string));
		}
	}
	const mutate = async (
		action: string,
		args: Record<string, unknown>,
		context: Context,
	): Promise<Result<void, FileError>> => {
		const result = await call(action, args, context);
		return result.ok ? ok(undefined) : result;
	};
	const env: ExecutionEnv = {
		id: `device:${deviceId}`,
		cwd,
		absolutePath: async (path) => ok(absolute(path)),
		joinPath: async (parts) => ok(pathApi.join(...parts)),
		canonicalPath: (path, ctx) => call<string>("fs.canonical", { path: absolute(path) }, ctx),
		fileInfo: (path, ctx) => call<FileInfo>("fs.stat", { path: absolute(path) }, ctx),
		listDir: (path, ctx) => call<FileInfo[]>("fs.list", { path: absolute(path) }, ctx),
		async readBinaryFile(path, ctx) {
			const value = await call<{ dataBase64: string }>("fs.read", { path: absolute(path) }, ctx);
			return value.ok ? ok(Buffer.from(value.value.dataBase64, "base64")) : value;
		},
		async readTextFile(path, ctx) {
			const value = await env.readBinaryFile(path, ctx);
			return value.ok ? ok(new TextDecoder().decode(value.value)) : value;
		},
		async readTextLines(path, options, ctx) {
			const value = await env.readTextFile(path, ctx);
			return value.ok ? ok(value.value.split(/\r?\n/).slice(0, options?.maxLines)) : value;
		},
		async openTextLineReader(path, ctx): Promise<Result<TextLineReader, FileError>> {
			const value = await env.readTextFile(path, ctx);
			if (!value.ok) return value;
			const lines = value.value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
			let index = 0;
			return ok({
				readLine: async () => {
					const line = lines[index++];
					return ok(
						line === undefined ? undefined : { text: line.replace(/\r?\n$/, ""), terminated: line.endsWith("\n") },
					);
				},
				close: async () => {
					index = lines.length;
				},
			});
		},
		async openBinaryReader(path, options, ctx): Promise<Result<BinaryReader, FileError>> {
			const info = await env.fileInfo(path, ctx);
			if (!info.ok) return info;
			if (info.value.kind === "directory" || (options?.noFollow && info.value.kind === "symlink"))
				return err(new FileError("invalid", "Not a regular file", path));
			const data = await env.readBinaryFile(path, ctx);
			if (!data.ok) return data;
			let closed = false;
			return ok({
				info: async () => ok({ ...info.value, size: data.value.byteLength }),
				read: async (offset, length) =>
					closed ? err(new FileError("invalid", "Reader closed")) : ok(data.value.slice(offset, offset + length)),
				scanLines: async (options) => {
					const scanner = new LineScanner(options.startLine, options.endLine);
					scanner.push(data.value);
					return ok(scanner.finish());
				},
				close: async () => {
					closed = true;
				},
			});
		},
		writeFile: (path, content, ctx) =>
			mutate("fs.write", { path: absolute(path), dataBase64: Buffer.from(content).toString("base64") }, ctx),
		appendFile: (path, content, ctx) =>
			mutate(
				"fs.write",
				{ path: absolute(path), dataBase64: Buffer.from(content).toString("base64"), append: true },
				ctx,
			),
		truncateFile: (path, size, ctx) => mutate("fs.truncate", { path: absolute(path), size }, ctx),
		flushFile: (path, ctx) => mutate("fs.flush", { path: absolute(path) }, ctx),
		renameFile: (path, destination, ctx) =>
			mutate("fs.rename", { path: absolute(path), destination: absolute(destination) }, ctx),
		createDir: (path, options, ctx) => mutate("fs.mkdir", { path: absolute(path), ...options }, ctx),
		remove: (path, options, ctx) => mutate("fs.remove", { path: absolute(path), ...options }, ctx),
		async exists(path, ctx) {
			const result = await env.fileInfo(path, ctx);
			return result.ok ? ok(true) : result.error.code === "not_found" ? ok(false) : result;
		},
		async openDirReader(path, ctx): Promise<Result<DirReader, FileError>> {
			const result = await env.listDir(path, ctx);
			if (!result.ok) return result;
			let offset = 0;
			return ok({
				next: async (count) => {
					const entries = result.value.slice(offset, offset + count);
					offset += entries.length;
					return ok({ entries, done: offset >= result.value.length });
				},
				close: async () => {
					offset = result.value.length;
				},
			});
		},
		watch: async () => err(new FileError("not_supported", "Remote file watching is unavailable")),
		async createTempDir(prefix, ctx) {
			const path = absolute(`${prefix ?? ".yonder-"}${randomUUID()}`);
			const result = await env.createDir(path, {}, ctx);
			return result.ok ? ok(path) : result;
		},
		async createTempFile(options, ctx) {
			const path = absolute(`${options?.prefix ?? ".yonder-"}${randomUUID()}${options?.suffix ?? ""}`);
			const result = await env.writeFile(path, "", ctx);
			return result.ok ? ok(path) : result;
		},
		async exec(command, options: ShellExecOptions | undefined, ctx) {
			try {
				const value = getOrThrow(
					await call<{ exitCode: number; stdout: string; stderr: string; spillPath?: string }>(
						"process.exec",
						{
							command,
							cwd: absolute(options?.cwd ?? cwd),
							...(options?.env ? { env: options.env } : {}),
							...(options?.timeout ? { timeout: options.timeout * 1000 } : {}),
						},
						ctx,
					),
				);
				if (value.stdout) options?.onOutput?.(value.stdout, ctx, { stream: "stdout" });
				if (value.stderr) options?.onOutput?.(value.stderr, ctx, { stream: "stderr" });
				return ok({ exitCode: value.exitCode, ...(value.spillPath ? { spillPath: value.spillPath } : {}) });
			} catch (error) {
				return err(
					new ExecutionError(
						(error as { cause?: { code?: string } }).cause?.code === "OUTCOME_UNKNOWN"
							? "unknown"
							: ctx.abortSignal?.aborted
								? "aborted"
								: "unknown",
						error instanceof Error ? error.message : String(error),
					),
				);
			}
		},
		cleanup: async () => {},
	};
	return env;
}
