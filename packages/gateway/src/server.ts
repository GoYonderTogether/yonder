import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type GatewayHost, gatewaySettings, type HostCtx, MethodError, type Principal, registry } from "@yonder/core";
import { type WebSocket, WebSocketServer } from "ws";
import {
	COOKIE,
	COOKIE_TTL_MS,
	cookieValue,
	Limiter,
	type Login,
	principals,
	Sessions,
	safeEqual,
	Tickets,
	tokenHash,
} from "./auth.js";
import { BodyError, fail, loginPage, readBody, redirect, send, sendJson, serveStatic } from "./http.js";
import { type FeedEvent, Feeds, type Listener } from "./stream.js";

export type GatewayHostCtx = Omit<HostCtx, "principal" | "gateway">;
export interface GatewayOptions {
	home: string;
	host: GatewayHostCtx;
	/** Directory of the built web app; defaults to <repo>/apps/app/dist. */
	staticDir?: string;
}
export interface GatewayHandle extends GatewayHost {
	port: number;
	close(): Promise<void>;
}

const DEFAULT_PORT = 7690;
const MAX_SUBS = 64;
const SLOW_BYTES = 10 * 1024 * 1024;
const IDLE_MS = 60_000;

const defaultStatic = () => resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/app/dist");

function errorOf(error: unknown): { code: string; message: string } {
	if (error instanceof MethodError) return { code: error.code, message: error.message };
	return { code: "error", message: error instanceof Error ? error.message : String(error) };
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
	const { home, host } = options;
	const settings = await gatewaySettings(home);
	const stateFile = join(home, ".yonder", "gateway.json");
	const sessions = await Sessions.open(home);
	const tickets = new Tickets();
	const limiter = new Limiter();
	const feeds = new Feeds();
	const staticDir = options.staticDir ?? defaultStatic();
	const basePath = settings.basePath;
	let port = 0;

	// Re-read the stored hash shortly after changes so `ui token --rotate` takes effect without a restart.
	let hashCache: { at: number; value: string | undefined } = { at: 0, value: undefined };
	const accessHash = async () => {
		if (Date.now() - hashCache.at > 1000)
			hashCache = { at: Date.now(), value: (await gatewaySettings(home)).accessTokenHash };
		return hashCache.value;
	};

	const publicHosts = settings.publicOrigins.map((origin) => new URL(origin));
	const hostAllowed = (value: string | undefined) =>
		!!value &&
		(value === `127.0.0.1:${port}` || value === `localhost:${port}` || publicHosts.some((url) => url.host === value));
	const originAllowed = (value: string) =>
		value === `http://127.0.0.1:${port}` ||
		value === `http://localhost:${port}` ||
		settings.publicOrigins.includes(value);
	const secureFor = (hostHeader: string | undefined) =>
		publicHosts.some((url) => url.protocol === "https:" && url.host === hostHeader);

	/** Host, Origin and Sec-Fetch-Site checks shared by HTTP and WS. `strict` = not a plain navigation. */
	function guard(req: IncomingMessage, strict: boolean): string | undefined {
		if (!hostAllowed(req.headers.host)) return "host not allowed";
		const origin = req.headers.origin;
		if (origin !== undefined && !originAllowed(origin)) return "origin not allowed";
		const site = req.headers["sec-fetch-site"];
		if (strict && site !== undefined && site !== "same-origin") return "cross-site request refused";
		return undefined;
	}

	async function loginOf(req: IncomingMessage): Promise<Login | undefined> {
		return sessions.verify(cookieValue(req.headers.cookie, COOKIE), await accessHash());
	}
	const cookieHeader = (req: IncomingMessage, login: Login, hash: string | undefined) =>
		`${COOKIE}=${sessions.sign(login, hash)}; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_TTL_MS / 1000}${
			secureFor(req.headers.host) ? "; Secure" : ""
		}`;

	/** Exchange a one-time ticket or the long-lived access token for a login kind. */
	async function exchange(token: string): Promise<Login | undefined> {
		if (limiter.blocked("login")) return undefined;
		if (tickets.consume(token)) return "local";
		const hash = await accessHash();
		if (hash && safeEqual(tokenHash(token), hash)) return "remote";
		limiter.fail("login");
		return undefined;
	}

	const ctxFor = (login: Login): HostCtx => ({ ...host, principal: principals[login], gateway: handle });

	async function handleRpc(
		req: IncomingMessage,
		res: import("node:http").ServerResponse,
		method: string,
		login: Login,
	) {
		if (!/^application\/json(;|$)/i.test(req.headers["content-type"] ?? ""))
			return fail(res, 415, "invalid_params", "Content-Type must be application/json");
		const raw = await readBody(req, 10 * 1024 * 1024);
		let params: unknown = {};
		if (raw.length) {
			try {
				params = JSON.parse(raw.toString("utf8"));
			} catch {
				return sendJson(res, 200, { ok: false, error: { code: "invalid_params", message: "body is not valid JSON" } });
			}
		}
		const abort = new AbortController();
		res.on("close", () => abort.abort());
		try {
			const def = registry.prepare(method, params, principals[login]);
			if (def.stream) throw new MethodError("invalid_params", `${method} is a stream; use /api/stream`);
			sendJson(res, 200, { ok: true, result: await registry.call(method, params, ctxFor(login), abort.signal) });
		} catch (error) {
			sendJson(res, 200, { ok: false, error: errorOf(error) });
		}
	}

	const server: Server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://gateway.invalid");
			const api = url.pathname.startsWith("/api/");
			const write = req.method !== "GET" && req.method !== "HEAD";
			const refused = guard(req, api || write);
			if (refused) return fail(res, 403, "forbidden", refused);

			if (url.pathname === "/login") {
				if (req.method === "GET") return send(res, 200, loginPage(basePath), "text/html; charset=utf-8");
				if (req.method !== "POST") return fail(res, 405, "invalid_params", "method not allowed");
				const type = req.headers["content-type"] ?? "";
				const json = /^application\/json(;|$)/i.test(type);
				if (!json && !/^application\/x-www-form-urlencoded(;|$)/i.test(type))
					return fail(res, 415, "invalid_params", "unsupported content type");
				const text = (await readBody(req, 4096)).toString("utf8");
				let token: unknown;
				try {
					token = json ? (JSON.parse(text) as { token?: unknown }).token : new URLSearchParams(text).get("token");
				} catch {
					token = undefined;
				}
				if (limiter.blocked("login")) return fail(res, 429, "unavailable", "too many attempts; wait a minute");
				const login = typeof token === "string" && token ? await exchange(token) : undefined;
				if (!login) {
					if (json) return fail(res, 401, "forbidden", "invalid token");
					return send(res, 401, loginPage(basePath, "令牌无效 · Invalid token"), "text/html; charset=utf-8");
				}
				const cookie = { "Set-Cookie": cookieHeader(req, login, login === "remote" ? await accessHash() : undefined) };
				if (json) return sendJson(res, 200, { ok: true, result: { kind: principals[login].kind } }, cookie);
				return redirect(res, basePath, cookie);
			}

			if (url.pathname === "/api/logout" && req.method === "POST") {
				return sendJson(
					res,
					200,
					{ ok: true, result: {} },
					{
						"Set-Cookie": `${COOKIE}=; Path=${basePath}; HttpOnly; SameSite=Strict; Max-Age=0`,
					},
				);
			}

			// `?token=` on any page: one-time ticket (or access token) exchange, then a clean URL.
			const queryToken = url.searchParams.get("token");
			if (queryToken && req.method === "GET" && !api) {
				if (limiter.blocked("login")) return fail(res, 429, "unavailable", "too many attempts; wait a minute");
				const login = await exchange(queryToken);
				if (!login) return redirect(res, `${basePath}login`);
				return redirect(res, basePath, {
					"Set-Cookie": cookieHeader(req, login, login === "remote" ? await accessHash() : undefined),
				});
			}

			const login = await loginOf(req);
			if (!login) {
				if (api) return fail(res, 401, "forbidden", "login required");
				return redirect(res, `${basePath}login`);
			}

			if (url.pathname.startsWith("/api/rpc/")) {
				if (req.method !== "POST") return fail(res, 405, "invalid_params", "use POST");
				return await handleRpc(req, res, decodeURIComponent(url.pathname.slice("/api/rpc/".length)), login);
			}
			if (api) return fail(res, 404, "not_found", "unknown endpoint");
			if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "invalid_params", "method not allowed");
			if (await serveStatic(res, staticDir, url.pathname, basePath)) return;
			send(
				res,
				404,
				"Not found. The web app is served from apps/app/dist; build it first if it is missing.\n",
				"text/plain; charset=utf-8",
			);
		} catch (error) {
			if (error instanceof BodyError) return fail(res, error.status, "invalid_params", error.message);
			// Internal details stay out of responses.
			fail(res, 500, "error", "internal error");
		}
	});

	// ---- WebSocket /api/stream -------------------------------------------------
	const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
	const sockets = new Set<WebSocket>();

	server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const reject = (status: number, text: string) => {
			socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
			socket.destroy();
		};
		try {
			const url = new URL(req.url ?? "/", "http://gateway.invalid");
			if (url.pathname !== "/api/stream") return reject(404, "Not Found");
			if (guard(req, true)) return reject(403, "Forbidden");
			if (url.searchParams.get("v") && url.searchParams.get("v") !== "1") return reject(426, "Upgrade Required");
			const login = await loginOf(req);
			if (!login) return reject(401, "Unauthorized");
			wss.handleUpgrade(req, socket, head, (ws) => connection(ws, login));
		} catch {
			reject(500, "Internal Server Error");
		}
	});

	function connection(ws: WebSocket, login: Login) {
		sockets.add(ws);
		const principal: Principal = principals[login];
		const subs = new Map<string, () => void>();
		let lastSeen = Date.now();
		const frame = (value: unknown) => {
			if (ws.readyState !== ws.OPEN) return;
			if (ws.bufferedAmount > SLOW_BYTES) {
				for (const sub of [...subs.keys()]) {
					subs.get(sub)?.();
					ws.send(
						JSON.stringify({
							t: "end",
							sub,
							reason: "error",
							error: { code: "unavailable", message: "slow-consumer" },
						}),
					);
				}
				ws.close(1013, "slow-consumer");
				return;
			}
			ws.send(JSON.stringify(value));
		};
		const end = (sub: string, reason: string, error?: { code: string; message: string }) =>
			frame({ t: "end", sub, reason, ...(error ? { error } : {}) });
		const idle = setInterval(() => {
			if (Date.now() - lastSeen > IDLE_MS) ws.close(4408, "idle");
		}, 10_000);
		idle.unref();

		async function subscribe(sub: string, method: string, params: unknown, after: unknown) {
			if (subs.has(sub)) return end(sub, "error", { code: "conflict", message: "duplicate sub id" });
			if (subs.size >= MAX_SUBS) return end(sub, "error", { code: "unavailable", message: "too many subscriptions" });
			subs.set(sub, () => {});
			try {
				const def = registry.prepare(method, params ?? {}, principal);
				if (!def.stream) throw new MethodError("invalid_params", `${method} is not a stream method`);
				const feed = await feeds.acquire(method, params ?? {}, ctxFor(login));
				let ready = false;
				const queue: FeedEvent[] = [];
				let n = 0;
				const emit = (event: FeedEvent) => {
					frame({
						t: "ev",
						sub,
						seq: ++n,
						cursor: feed.resumable ? `${feed.epoch}:${event.seq}` : "",
						type: def.stream?.type,
						ts: event.ts,
						data: event.data,
					});
				};
				// Synchronously decide replay vs fresh and start listening, so no event falls between the two.
				const covered = feed.seq;
				const replay = typeof after === "string" && after ? feed.replay(after) : undefined;
				const listener: Listener = {
					push(event) {
						if (event.seq <= covered) return;
						if (ready) emit(event);
						else queue.push(event);
					},
					end(reason, error) {
						subs.delete(sub);
						end(sub, reason, error ? { code: "error", message: error } : undefined);
					},
				};
				feed.join(listener);
				subs.set(sub, () => {
					feed.leave(listener);
					subs.delete(sub);
				});
				const resumed = replay !== undefined;
				let result: unknown = null;
				if (!resumed) {
					result = feed.initial;
					if (method === "sessions.watch") {
						const id = (params as { id: string }).id;
						const ctx = ctxFor(login);
						const meta = (await registry.call(
							"sessions.show",
							{ id, include: "meta" },
							ctx,
							new AbortController().signal,
						)) as object;
						const transcript = await registry.call("sessions.transcript", { id }, ctx, new AbortController().signal);
						result = { ...meta, transcript };
					}
				}
				if (!subs.has(sub)) return;
				frame({
					t: "ready",
					sub,
					gap: feed.resumable ? typeof after === "string" && after !== "" && !resumed : true,
					cursor: feed.resumable ? `${feed.epoch}:${covered}` : "",
					result,
				});
				for (const event of replay ?? []) if (event.seq <= covered) emit(event);
				ready = true;
				for (const event of queue) emit(event);
			} catch (error) {
				subs.get(sub)?.();
				subs.delete(sub);
				const info = errorOf(error);
				end(sub, info.code === "forbidden" ? "forbidden" : "error", info);
			}
		}

		ws.on("message", (raw) => {
			lastSeen = Date.now();
			let msg: { t?: unknown; sub?: unknown; method?: unknown; params?: unknown; after?: unknown; n?: unknown };
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return ws.close(1003, "invalid frame");
			}
			if (msg.t === "ping") return frame({ t: "pong", ...(msg.n === undefined ? {} : { n: msg.n }) });
			if (typeof msg.sub !== "string" || !msg.sub) return;
			if (msg.t === "unsub") {
				if (!subs.has(msg.sub)) return;
				subs.get(msg.sub)?.();
				subs.delete(msg.sub);
				return end(msg.sub, "unsub");
			}
			if (msg.t === "sub" && typeof msg.method === "string") void subscribe(msg.sub, msg.method, msg.params, msg.after);
		});
		ws.on("close", () => {
			clearInterval(idle);
			sockets.delete(ws);
			for (const dispose of subs.values()) dispose();
			subs.clear();
		});
		ws.on("error", () => ws.terminate());
	}

	// ---- listen -----------------------------------------------------------------
	const listenOn = (candidate: number) =>
		new Promise<void>((resolveListen, rejectListen) => {
			const onError = (error: Error) => rejectListen(error);
			server.once("error", onError);
			server.listen(candidate, "127.0.0.1", () => {
				server.off("error", onError);
				resolveListen();
			});
		});
	const start = settings.port ?? DEFAULT_PORT;
	for (let candidate = start; ; candidate++) {
		try {
			await listenOn(candidate);
			port = candidate;
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || candidate - start >= 50) throw error;
		}
	}

	const startup = tickets.issue(Number.POSITIVE_INFINITY);
	await mkdir(dirname(stateFile), { recursive: true });
	await writeFile(stateFile, JSON.stringify({ port, pid: process.pid, token: startup.token, basePath }), {
		mode: 0o600,
	});

	const handle: GatewayHandle = {
		port,
		ticket() {
			const ticket = tickets.issue();
			return { token: ticket.token, expiresAt: new Date(ticket.expiresAt).toISOString(), port, basePath };
		},
		async close() {
			for (const ws of sockets) {
				ws.send(JSON.stringify({ t: "end", sub: "*", reason: "shutdown" }));
				ws.close(1001, "shutdown");
			}
			feeds.closeAll();
			wss.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(stateFile, { force: true });
		},
	};
	return handle;
}
