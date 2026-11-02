import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm, truncate } from "node:fs/promises";
import { cpus, freemem, hostname, release, totalmem } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { DeviceDescriptor, ExecutionCapability } from "@yonder/protocol";
import type { BackendAction, BackendProvider } from "../backend-provider.js";
import { executeHostProcess, type ProcessInput } from "./host-process.js";

export const HOST_TARGET = "host:filesystem";
export const MAX_REMOTE_FILE_BYTES = 512 * 1024;

/** Resolve both existing symlinks and the existing parents of a new path. */
export function canonicalHostPath(path: string, links = 0): string {
	if (links > 40) throw Object.assign(new Error("Too many symbolic links"), { code: "ELOOP" });
	try {
		return realpathSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		try {
			if (lstatSync(path).isSymbolicLink())
				return canonicalHostPath(resolve(dirname(path), readlinkSync(path)), links + 1);
		} catch (failure) {
			if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
		}
		const parent = dirname(path);
		if (parent === path) throw error;
		return join(canonicalHostPath(parent, links), basename(path));
	}
}

const pathValue = (value: unknown): value is string =>
	typeof value === "string" && isAbsolute(value) && !value.includes("\0");
const within = (root: string, path: string) => {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};
const scopes = (args: Record<string, unknown>) =>
	args.scopeRoots === undefined || (Array.isArray(args.scopeRoots) && args.scopeRoots.every(pathValue));
const errorResult = (error: unknown) => ({
	error: {
		code: (error as NodeJS.ErrnoException).code ?? "EIO",
		message: error instanceof Error ? error.message : "Filesystem operation failed",
	},
});
const info = (path: string, stat: Awaited<ReturnType<typeof lstat>>) => ({
	name: basename(path),
	path,
	kind: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file",
	size: stat.size,
	mtimeMs: stat.mtimeMs,
});

export function createHostProvider(
	deviceId: string,
	role: "full" | "execution-only",
	desktop?: BackendProvider,
): BackendProvider {
	const definitions: Record<
		string,
		{
			write?: boolean;
			keys: string[];
			validate?: (args: Record<string, unknown>) => boolean;
			run(args: Record<string, unknown>, path: string, signal: AbortSignal): Promise<unknown>;
		}
	> = {
		"fs.canonical": { keys: ["path"], run: async (_args, path) => path },
		"fs.stat": { keys: ["path"], run: async (_args, path) => info(path, await lstat(path)) },
		"fs.list": {
			keys: ["path"],
			run: async (_args, path) =>
				Promise.all(
					(await readdir(path)).map(async (name) => {
						const child = join(path, name);
						return info(child, await lstat(child));
					}),
				),
		},
		"fs.read": {
			keys: ["path"],
			run: async (_args, path, signal) => {
				const file = await open(path, "r");
				try {
					if ((await file.stat()).size > MAX_REMOTE_FILE_BYTES)
						throw Object.assign(new Error("Remote file exceeds 512 KiB read limit"), { code: "EFBIG" });
					const buffer = Buffer.alloc(MAX_REMOTE_FILE_BYTES + 1);
					let offset = 0;
					while (offset < buffer.length) {
						signal.throwIfAborted();
						const result = await file.read(buffer, offset, buffer.length - offset, offset);
						if (!result.bytesRead) break;
						offset += result.bytesRead;
					}
					if (offset > MAX_REMOTE_FILE_BYTES)
						throw Object.assign(new Error("Remote file exceeds 512 KiB read limit"), { code: "EFBIG" });
					return { dataBase64: buffer.subarray(0, offset).toString("base64") };
				} finally {
					await file.close();
				}
			},
		},
		"fs.write": {
			write: true,
			keys: ["path", "dataBase64", "append"],
			validate: (a) =>
				typeof a.dataBase64 === "string" &&
				a.dataBase64.length <= Math.ceil(MAX_REMOTE_FILE_BYTES / 3) * 4 &&
				/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.dataBase64) &&
				(a.append === undefined || typeof a.append === "boolean"),
			run: async (args, path) => {
				const file = await open(path, args.append ? "a" : "w", 0o600);
				try {
					await file.writeFile(Buffer.from(args.dataBase64 as string, "base64"));
					return { written: true };
				} finally {
					await file.close();
				}
			},
		},
		"fs.mkdir": {
			write: true,
			keys: ["path", "recursive"],
			validate: (a) => a.recursive === undefined || typeof a.recursive === "boolean",
			run: async (args, path) => {
				await mkdir(path, { recursive: args.recursive === true });
				return { created: true };
			},
		},
		"fs.remove": {
			write: true,
			keys: ["path", "recursive", "force"],
			validate: (a) => [a.recursive, a.force].every((value) => value === undefined || typeof value === "boolean"),
			run: async (args, path) => {
				await rm(path, { recursive: args.recursive === true, force: args.force === true });
				return { removed: true };
			},
		},
		"fs.rename": {
			write: true,
			keys: ["path", "destination"],
			validate: (a) => pathValue(a.destination),
			run: async (args, path) => {
				await rename(path, linkPath(args.destination as string));
				return { renamed: true };
			},
		},
		"fs.truncate": {
			write: true,
			keys: ["path", "size"],
			validate: (a) => Number.isSafeInteger(a.size) && (a.size as number) >= 0,
			run: async (args, path) => {
				await truncate(path, args.size as number);
				return { truncated: true };
			},
		},
		"fs.flush": {
			write: true,
			keys: ["path"],
			run: async (_args, path) => {
				const file = await open(path, "r+");
				try {
					await file.sync();
					return { flushed: true };
				} finally {
					await file.close();
				}
			},
		},
	};
	function linkPath(path: string) {
		return join(canonicalHostPath(dirname(path)), basename(path));
	}
	function paths(name: string, args: Record<string, unknown>) {
		const canonical = name === "fs.remove" || name === "fs.rename" || name === "fs.stat" ? linkPath : canonicalHostPath;
		return [canonical(args.path as string), ...(name === "fs.rename" ? [linkPath(args.destination as string)] : [])];
	}
	function checkScope(args: Record<string, unknown>, resources: string[]) {
		if (!Array.isArray(args.scopeRoots)) return;
		const roots = args.scopeRoots.map((root) => canonicalHostPath(root as string));
		if (resources.some((path) => !roots.some((root) => within(root, path))))
			throw Object.assign(new Error("Path is outside the selected workspace"), { code: "EACCES" });
	}
	const actions: Record<string, BackendAction> = { ...desktop?.actions };
	for (const [name, definition] of Object.entries(definitions)) {
		const validate = (args: Record<string, unknown>) =>
			pathValue(args.path) &&
			scopes(args) &&
			Object.keys(args).every((key) => definition.keys.includes(key) || key === "scopeRoots") &&
			(!definition.validate || definition.validate(args));
		actions[name] = {
			capabilities: [definition.write ? "write" : "read"] as ExecutionCapability[],
			mutatesDevice: !!definition.write,
			validate,
			resources: (args) => ({
				readRoots: definition.write ? [] : paths(name, args),
				writeRoots: definition.write ? paths(name, args) : [],
			}),
			async execute(args, context) {
				if (context.session.deviceId !== deviceId || context.session.targetId !== HOST_TARGET)
					throw new Error("WRONG_TARGET");
				if (!validate(args)) throw new Error("INVALID_REQUEST");
				context.signal.throwIfAborted();
				try {
					const resources = paths(name, args);
					checkScope(args, resources);
					return await definition.run(args, resources[0]!, context.signal);
				} catch (error) {
					if (context.signal.aborted) throw error;
					return errorResult(error);
				}
			},
		};
	}
	const execValidate = (a: Record<string, unknown>) =>
		pathValue(a.cwd) &&
		scopes(a) &&
		Object.keys(a).every((key) => ["command", "cwd", "env", "timeout", "scopeRoots"].includes(key)) &&
		(typeof a.command === "string"
			? a.command.length > 0 && !a.command.includes("\0")
			: Array.isArray(a.command) &&
				a.command.length > 0 &&
				a.command.every((part) => typeof part === "string" && !part.includes("\0")) &&
				!!a.command[0]) &&
		(a.timeout === undefined || (Number.isSafeInteger(a.timeout) && (a.timeout as number) > 0)) &&
		(a.env === undefined ||
			(!!a.env &&
				typeof a.env === "object" &&
				!Array.isArray(a.env) &&
				Object.entries(a.env).every(
					([key, value]) => key.length > 0 && !/[=\0]/.test(key) && typeof value === "string" && !value.includes("\0"),
				)));
	actions["process.exec"] = {
		capabilities: ["exec", "write"],
		mutatesDevice: true,
		validate: execValidate,
		resources: (args) => ({
			readRoots: [canonicalHostPath(args.cwd as string)],
			writeRoots: [canonicalHostPath(args.cwd as string)],
		}),
		async execute(args, context) {
			if (context.session.deviceId !== deviceId || context.session.targetId !== HOST_TARGET)
				throw new Error("WRONG_TARGET");
			if (!execValidate(args)) throw new Error("INVALID_REQUEST");
			try {
				const cwd = canonicalHostPath(args.cwd as string);
				checkScope(args, [cwd]);
				return await executeHostProcess({ ...args, cwd } as unknown as ProcessInput, context.signal);
			} catch (error) {
				if (context.signal.aborted) throw error;
				return errorResult(error);
			}
		},
	};
	return {
		actions,
		async describe(): Promise<DeviceDescriptor> {
			const observedAt = new Date().toISOString();
			const base: DeviceDescriptor = desktop
				? await desktop.describe()
				: {
						schemaVersion: 1,
						deviceId,
						role,
						os: { name: process.platform, version: release() },
						hostArch: process.arch,
						processArch: process.arch,
						runtimeVersion: process.version,
						targets: [],
						capabilities: [],
						resources: {
							observedAt,
							cpuCount: cpus().length,
							memoryTotalBytes: totalmem(),
							memoryAvailableBytes: freemem(),
						},
						apps: { observedAt: null, status: "unsupported", complete: false },
						lastSeenAt: observedAt,
						health: "ready",
						routes: [],
						checkpointRestore: "unsupported",
					};
			return {
				...base,
				targets: [...base.targets, { id: HOST_TARGET, name: hostname() }],
				capabilities: [
					...base.capabilities,
					...Object.keys(actions)
						.filter((name) => name.startsWith("fs.") || name === "process.exec")
						.map((id) => ({ id, version: "1", scope: HOST_TARGET, state: "available" as const })),
				],
			};
		},
		async apps(targetId) {
			if (targetId !== HOST_TARGET && desktop) return desktop.apps(targetId);
			if (targetId !== HOST_TARGET) throw new Error("WRONG_TARGET");
			return {
				deviceId,
				targetId,
				observedAt: null,
				status: "unsupported",
				complete: false,
				items: [],
				reason: "Filesystem target has no application inventory",
			};
		},
		async snapshot(session) {
			if (session.targetId !== HOST_TARGET && desktop) return desktop.snapshot(session);
			if (session.deviceId !== deviceId || session.targetId !== HOST_TARGET) throw new Error("WRONG_TARGET");
			return {
				deviceId,
				deviceSessionId: session.deviceSessionId,
				targetId: HOST_TARGET,
				observedAt: new Date().toISOString(),
				status: "unsupported",
				reason: "Filesystem target has no graphical snapshot",
			};
		},
	};
}
