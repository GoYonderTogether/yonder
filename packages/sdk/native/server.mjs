// Copyright 2026 Yonder contributors. Apache-2.0.
import { EventEmitter } from "node:events";
import { createPipeListener } from "./listener.mjs";

// Only the Server methods used by the two local IPC endpoints; connected sockets
// remain actual node:net Socket instances and retain their existing protocol.
export function createNativeServer(binding, onConnection) {
	return new NativeServer(binding, onConnection);
}
class NativeServer extends EventEmitter {
	listening = false;
	#binding;
	#listener;
	constructor(binding, onConnection) {
		super();
		this.#binding = binding;
		this.on("connection", onConnection);
	}
	listen(options, callback) {
		if (this.listening) throw new Error("Local pipe server is already listening");
		if (!options || typeof options.path !== "string" || options.readableAll || options.writableAll)
			throw new TypeError("Local pipe server requires an owner-only path");
		try {
			this.#listener = createPipeListener(this.#binding)(
				options.path,
				(socket) => this.emit("connection", socket),
				(error) => {
					this.listening = false;
					this.emit("error", error);
				},
			);
			this.listening = true;
			queueMicrotask(() => {
				if (this.listening) {
					this.emit("listening");
					callback?.();
				}
			});
		} catch (error) {
			queueMicrotask(() => this.emit("error", error));
		}
		return this;
	}
	close(callback) {
		if (!this.listening) {
			const error = Object.assign(new Error("Server is not running"), { code: "ERR_SERVER_NOT_RUNNING" });
			queueMicrotask(() => callback?.(error));
			return this;
		}
		this.listening = false;
		void this.#listener.close().then(
			() => {
				this.emit("close");
				callback?.();
			},
			(error) => (callback ? callback(error) : this.emit("error", error)),
		);
		return this;
	}
}
