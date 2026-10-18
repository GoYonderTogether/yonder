import { createServer, type Server, type Socket } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { acct, conv, defineChannel, definePlugin, type ChannelIO, type PluginAPI, type PluginModule, type Ref } from "@yonder/sdk";

const channelProvider = (api: PluginAPI) => defineChannel({
	type: "cli",
	create(id: string, _config: unknown) {
		const account = acct(id, "local");
		const conversation = conv(id, "local");
		const socketPath = join(api.paths.data, `${id}.sock`);
		let server: Server | undefined;
		let client: Socket | undefined;
		let io: ChannelIO | undefined;

		const write = (socket: Socket, value: unknown) =>
			new Promise<void>((resolve, reject) => {
				socket.write(`${JSON.stringify(value)}\n`, (error) => (error ? reject(error) : resolve()));
			});

		return {
			id,
			kinds: ["dm"],
			output: { stream: true, attachments: false },
			async start(channelIO) {
				io = channelIO;
				await mkdir(api.paths.data, { recursive: true });
				await rm(socketPath, { force: true });
				server = createServer((socket) => {
					if (client) {
						socket.on("error", () => socket.destroy());
						void write(socket, { type: "error", message: "client already connected" }).then(() => socket.end(), () => socket.destroy());
						return;
					}
					client = socket;
					socket.setEncoding("utf8");
					const lines = createInterface({ input: socket, crlfDelay: Infinity });
					void (async () => {
						for await (const text of lines) {
							try {
								const event = await io?.emit({ type: "message.in", from: account, conv: conversation, data: { kind: "dm", text } });
								if (event) await write(socket, { type: "accepted", event });
							} catch (error) {
								await write(socket, { type: "error", message: error instanceof Error ? error.message : String(error) });
							}
						}
					})().catch(() => socket.destroy());
					socket.once("close", () => {
						if (client === socket) client = undefined;
					});
				});
				await new Promise<void>((resolve, reject) => {
					const onError = (error: Error) => reject(error);
					server?.once("error", onError);
					server?.listen(socketPath, () => {
						server?.off("error", onError);
						resolve();
					});
				});
			},
			async stop() {
				client?.destroy();
				client = undefined;
				if (server?.listening) {
					await new Promise<void>((resolve, reject) => server?.close((error) => error ? reject(error) : resolve()));
					await rm(socketPath, { force: true });
				}
				server = undefined;
			},
			async send(target: Ref, message) {
				if (target !== account && target !== conversation) return { ok: false, error: "unsupported target" };
				if (!client || client.destroyed) return { ok: false, error: "no client" };
				try {
					await write(client, { type: "message", text: message.text });
					return { ok: true };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
			async stream(target: Ref, output) {
				if (target !== conversation) return { ok: false, error: "unsupported target" };
				if (!client || client.destroyed) return { ok: false, error: "no client" };
				const recipient = client;
				try {
					for await (const part of output) await write(recipient, part);
					return { ok: true };
				} catch (error) {
					return { ok: false, error: error instanceof Error ? error.message : String(error) };
				}
			},
		};
	},
});

const plugin: PluginModule = definePlugin({
	setup(api) {
		api.channels.register(channelProvider(api));
	},
});

export default plugin;
