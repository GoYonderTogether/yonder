import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { ToolContext } from "@yonder/sdk";
import { renderText, taskBoard } from "./board.js";
import type { Store } from "./store.js";

/** URLs retain the caller's visibility; renderers never open the ledger. */
export class BoardService {
	private server: Server | undefined;
	private base = "";
	private callers = new Map<string, ToolContext>();
	constructor(
		private store: Store,
		private locale: string,
		private stallMinutes: number,
	) {}
	publish(ctx: ToolContext) {
		if (!this.base) throw new Error("Task board service is not running");
		const key = JSON.stringify([ctx.agent, ctx.session, ctx.profile, ctx.capabilities]);
		let token = [...this.callers].find(
			([, caller]) => JSON.stringify([caller.agent, caller.session, caller.profile, caller.capabilities]) === key,
		)?.[0];
		if (!token) {
			token = randomUUID();
			this.callers.set(token, ctx);
		}
		return `${this.base}${token}`;
	}
	async start() {
		const server = createServer((request, response) => {
			try {
				const url = new URL(request.url!, this.base);
				const caller = this.callers.get(url.pathname.slice(1));
				if (
					request.method !== "GET" ||
					request.headers.host !== new URL(this.base).host ||
					request.headers.origin ||
					!caller
				) {
					response.writeHead(403).end("Denied");
					return;
				}
				const id = url.searchParams.get("id");
				const board = taskBoard(
					this.store.list(caller),
					Date.now(),
					id ? this.store.get(id, caller) : undefined,
					this.stallMinutes,
				);
				response
					.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
					.end(JSON.stringify({ board, text: renderText(board, this.locale) }));
			} catch (error) {
				response.writeHead(400).end(error instanceof Error ? error.message : String(error));
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		this.server = server;
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Task board listener unavailable");
		this.base = `http://127.0.0.1:${address.port}/`;
	}
	async stop() {
		this.callers.clear();
		this.base = "";
		if (this.server) {
			this.server.closeAllConnections();
			await new Promise<void>((resolve, reject) => this.server!.close((error) => (error ? reject(error) : resolve())));
			this.server = undefined;
		}
	}
}
