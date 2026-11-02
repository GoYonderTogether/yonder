import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
export interface LocalServer extends EventEmitter {
	readonly listening: boolean;
	listen(options: { path: string; readableAll?: boolean; writableAll?: boolean }, callback: () => void): this;
	close(callback?: (error?: Error) => void): this;
}
export function createNativeServer(binding: unknown, onConnection: (socket: Socket) => void): LocalServer;
