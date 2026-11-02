// Copyright 2026 Yonder contributors. Apache-2.0.

import { closeSync } from "node:fs";
import { Socket } from "node:net";
export function createPipeListener(native) {
	return function listen(path, onConnection, onFailure) {
		const handle = native.create(path);
		let descriptor;
		try {
			descriptor = native.describe(handle);
		} catch (error) {
			native.close(handle);
			throw error;
		}
		const clients = new Map();
		let closed = false;
		let failure;
		const destroyClients = async () => {
			const completed = [...clients.values()];
			for (const socket of clients.keys()) socket.destroy();
			await Promise.all(completed);
		};
		const loop = (async () => {
			try {
				while (!closed) {
					const fd = await native.accept(handle);
					if (closed) {
						closeSync(fd);
						break;
					}
					let socket;
					try {
						// Node 22's PIPE open failure leaves fd with the caller; subsequent
						// read errors are emitted asynchronously by the adopted Socket.
						socket = new Socket({ fd, readable: true, writable: true });
					} catch (error) {
						closeSync(fd);
						throw error;
					}
					clients.set(
						socket,
						new Promise((resolve) =>
							socket.once("close", () => {
								clients.delete(socket);
								resolve();
							}),
						),
					);
					onConnection(socket);
				}
			} catch (error) {
				if (!closed) failure = error;
			} finally {
				closed = true;
				native.close(handle);
				await destroyClients();
				if (failure && onFailure) queueMicrotask(() => onFailure(failure));
			}
		})();
		return {
			descriptor,
			async close() {
				closed = true;
				native.close(handle);
				await destroyClients();
				await loop;
				if (failure) throw failure;
			},
			get failure() {
				return failure;
			},
		};
	};
}
