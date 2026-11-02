import {
	type BinaryReader,
	type DirReader,
	type ExecutionEnv,
	ExecutionError,
	err,
	FileError,
	type FileInfo,
	type FileListing,
	type FileWatcher,
	ok,
	type Result,
	type TextLineReader,
} from "@earendil-works/pi-durable/env";

function normalized(path: string, cwd: string): string {
	const parts: string[] = [];
	for (const part of `${path.startsWith("/") ? "" : `${cwd}/`}${path}`.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/** A path-aware environment for hosts that cannot execute or expose files. */
export function noEnvironment(cwd: string): ExecutionEnv {
	if (cwd.includes("\0")) throw new Error("Invalid logical working directory");
	const root = normalized(cwd, "/");
	const unavailable = <T>(path?: string) =>
		Promise.resolve(err<T, FileError>(new FileError("not_supported", "This environment has no file resources", path)));
	const invalid = <T>(path: string) =>
		Promise.resolve(err<T, FileError>(new FileError("invalid", "Invalid path", path)));
	const pathResult = (path: string): Promise<Result<string, FileError>> =>
		path.includes("\0") ? invalid<string>(path) : Promise.resolve(ok<string, FileError>(normalized(path, root)));
	return {
		id: "none",
		cwd: root,
		absolutePath: pathResult,
		joinPath: async (parts) => pathResult(parts.join("/")),
		readTextFile: async (path) => unavailable<string>(path),
		openTextLineReader: async (path) => unavailable<TextLineReader>(path),
		readTextLines: async (path) => unavailable<string[]>(path),
		readBinaryFile: async (path) => unavailable<Uint8Array>(path),
		openBinaryReader: async (path) => unavailable<BinaryReader>(path),
		writeFile: async (path) => unavailable<void>(path),
		appendFile: async (path) => unavailable<void>(path),
		truncateFile: async (path) => unavailable<void>(path),
		flushFile: async (path) => unavailable<void>(path),
		renameFile: async (source) => unavailable<void>(source),
		fileInfo: async (path) => unavailable<FileInfo>(path),
		listDir: async (path) => unavailable<FileInfo[]>(path),
		listFiles: async (path) => unavailable<FileListing>(path),
		openDirReader: async (path) => unavailable<DirReader>(path),
		watch: async (targets) => unavailable<FileWatcher>(targets[0]?.path),
		canonicalPath: pathResult,
		exists: async (path) => unavailable<boolean>(path),
		createDir: async (path) => unavailable<void>(path),
		remove: async (path) => unavailable<void>(path),
		createTempDir: async () => unavailable<string>(),
		createTempFile: async () => unavailable<string>(),
		cleanup: async () => {},
		exec: async () => err(new ExecutionError("shell_unavailable", "Command execution is not supported")),
	};
}
