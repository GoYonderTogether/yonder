import { createRequire } from "node:module";
import { createServer, type Socket } from "node:net";
import { createNativeServer, type LocalServer } from "../native/server.mjs";

export type { LocalServer } from "../native/server.mjs";

/** Windows native owner-only DACL; Unix retains Node's existing socket transport. */
export function createLocalServer(onConnection: (socket: Socket) => void): LocalServer {
	if (process.platform !== "win32") return createServer(onConnection);
	if (process.arch !== "x64" && process.arch !== "arm64")
		throw new Error(`Owner-only local IPC is not available for Windows ${process.arch}`);
	const binding = createRequire(import.meta.url)(`../native/win32-${process.arch}/owner-pipe.node`);
	return createNativeServer(binding, onConnection);
}
