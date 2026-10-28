import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join, win32 } from "node:path";
import { createInterface } from "node:readline";
import { MethodError } from "./method-types.js";

export interface ControlRequest {
	method: string;
	params?: unknown;
}

export interface ControlConnection {
	signal: AbortSignal;
	send(value: unknown): Promise<void>;
}
export type ControlHandler = (request: ControlRequest, connection: ControlConnection) => Promise<unknown>;

export function controlEndpoint(home: string, platform: NodeJS.Platform = process.platform) {
	if (platform === "win32")
		return `\\\\.\\pipe\\yonder-control-${createHash("sha256").update(win32.resolve(home).toLowerCase()).digest("hex").slice(0, 32)}`;
	return join(home, ".yonder", "control.sock");
}

export function cliChannelEndpoint(home: string, id: string, platform: NodeJS.Platform = process.platform) {
	const path =
		platform === "win32"
			? win32.join(home, ".yonder", "plugins", "channel-cli", `${id}.sock`)
			: join(home, ".yonder", "plugins", "channel-cli", `${id}.sock`);
	if (platform === "win32")
		return `\\\\.\\pipe\\yonder-cli-${createHash("sha256").update(win32.resolve(path).toLowerCase()).digest("hex").slice(0, 32)}`;
	return path;
}

function message(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

async function write(socket: Socket, value: unknown) {
	await new Promise<void>((resolve, reject) =>
		socket.write(`${JSON.stringify(value)}\n`, (error) => (error ? reject(error) : resolve())),
	);
}

export async function serveControl(home: string, handler: ControlHandler): Promise<{ close(): Promise<void> }> {
	const path = controlEndpoint(home);
	await mkdir(join(home, ".yonder"), { recursive: true });
	if (process.platform !== "win32") await rm(path, { force: true });
	const clients = new Set<Socket>();
	const server: Server = createServer((socket) => {
		clients.add(socket);
		const controller = new AbortController();
		socket.once("close", () => {
			clients.delete(socket);
			controller.abort();
		});
		socket.on("error", () => socket.destroy());
		let sending = Promise.resolve();
		const enqueue = (value: unknown) => {
			sending = sending.then(() => write(socket, value));
			return sending;
		};
		let ready = false;
		const buffered: unknown[] = [];
		const connection: ControlConnection = {
			signal: controller.signal,
			async send(value) {
				if (!ready) buffered.push(value);
				else await enqueue(value);
			},
		};
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		void (async () => {
			for await (const line of lines) {
				try {
					const request = JSON.parse(line) as ControlRequest;
					if (!request || typeof request.method !== "string") throw new Error("invalid control request");
					const result = await handler(request, connection);
					await enqueue({ ok: true, result });
					for (const value of buffered.splice(0)) void enqueue(value);
					ready = true;
					await sending;
				} catch (error) {
					await write(socket, {
						ok: false,
						error: message(error),
						...(error instanceof MethodError && error.data ? { data: error.data } : {}),
					});
				}
			}
		})().catch(() => socket.destroy());
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen({ path, readableAll: false, writableAll: false }, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		async close() {
			for (const client of clients) client.destroy();
			if (server.listening)
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			if (process.platform !== "win32") await rm(path, { force: true });
		},
	};
}

export function requestControl(home: string, request: ControlRequest): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(controlEndpoint(home));
		socket.setEncoding("utf8");
		let settled = false;
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			reject(error);
		};
		socket.once("error", fail);
		socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		lines.once("error", fail);
		lines.once("line", (line) => {
			if (settled) return;
			settled = true;
			try {
				const response = JSON.parse(line) as { ok: boolean; result?: unknown; error?: string };
				if (response.ok) resolve(response.result);
				else reject(new Error(response.error ?? "control request failed"));
			} catch (error) {
				reject(error);
			}
			socket.end();
		});
		socket.once("close", () => {
			if (!settled) fail(new Error("control connection closed without a response"));
		});
	});
}

/** A dedicated read-only stream; disconnect only releases the server observer. */
export function observeControl(
	home: string,
	request: ControlRequest,
	receive: (value: unknown) => void,
): Promise<{ result: unknown; close(): void }> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(controlEndpoint(home));
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		let ready = false;
		let closed = false;
		const fail = (error: Error) => {
			if (!ready) reject(error);
			else if (!closed) receive({ type: "disconnected", error: error.message });
			socket.destroy();
		};
		socket.on("error", fail);
		lines.on("error", fail);
		socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
		lines.on("line", (line) => {
			try {
				const value = JSON.parse(line);
				if (!ready) {
					if (!value.ok) throw new Error(value.error ?? "subscription failed");
					ready = true;
					resolve({
						result: value.result,
						close() {
							closed = true;
							lines.close();
							socket.destroy();
						},
					});
				} else receive(value);
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.once("close", () => {
			if (!closed) fail(new Error("control stream disconnected"));
		});
	});
}
