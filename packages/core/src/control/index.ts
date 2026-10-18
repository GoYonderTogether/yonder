import { mkdir, rm } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface ControlRequest {
	method: string;
	params?: unknown;
}

export type ControlHandler = (request: ControlRequest) => Promise<unknown>;

function socketPath(home: string) {
	return join(home, ".yonder", "control.sock");
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
	const path = socketPath(home);
	await mkdir(join(home, ".yonder"), { recursive: true });
	await rm(path, { force: true });
	const server: Server = createServer((socket) => {
		socket.setEncoding("utf8");
		const lines = createInterface({ input: socket, crlfDelay: Infinity });
		void (async () => {
			for await (const line of lines) {
				try {
					const request = JSON.parse(line) as ControlRequest;
					if (!request || typeof request.method !== "string") throw new Error("invalid control request");
					await write(socket, { ok: true, result: await handler(request) });
				} catch (error) {
					await write(socket, { ok: false, error: message(error) });
				}
			}
		})().catch(() => socket.destroy());
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		async close() {
			if (server.listening)
				await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			await rm(path, { force: true });
		},
	};
}

export function requestControl(home: string, request: ControlRequest): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath(home));
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
