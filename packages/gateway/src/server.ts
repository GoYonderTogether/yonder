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
	principalOf,
	principals,
	Sessions,
	safeEqual,
	Tickets,
	tokenHash,
} from "./auth.js";
import { mapEvent } from "./events.js";
import { BodyError, fail, loginPage, readBody, redirect, send, sendJson, serveStatic } from "./http.js";
import { mountRoutes } from "./routes/index.js";
import { sessionSnapshot } from "./snapshot.js";
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
	/** Open WebSockets and live feeds, for diagnostics and tests. */
	stats(): { sockets: number; feeds: number };
	close(): Promise<void>;
}
const DEFAULT_PORT = 7690;
const MAX_SUBS = 64;
const SLOW_BYTES = 10 * 1024 * 1024;
const IDLE_MS = 60_000;
const MAX_SOCKETS = 32;
const QUEUE_MAX = 1000;
const isLoopback = (address: string | undefined) =>
	address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
const defaultStatic = () => resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/app/dist");
function errorOf(error: unknown): { code: string; message: string; data?: Record<string, string> } {
	if (error instanceof MethodError)
		return { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) };
	return { code: "error", message: error instanceof Error ? error.message : String(error) };
}

export async function startGateway(options: GatewayOptions): Promise<GatewayHandle> {
	const { home, host } = options;
	const settings = await gatewaySettings(home);
	const stateFile = join(home, ".yonder", "gateway.json");
	const sessions = await Sessions.open(home);
	const tickets = new Tickets();
	const limiter = new Limiter();
	const trustProxy = settings.trustProxy;
	const feeds = new Feeds();
	const staticDir = options.staticDir ?? defaultStatic();
	const basePath = settings.basePath;
	let port = 0;

	// Re-read the stored hash shortly after changes so `ui token --rotate` takes effect without a restart.
	let hashCache: { at: number; value: string | undefined } = { at: 0, value: undefined };
	const refreshHash = async () => {
		const value = (await gatewaySettings(home)).accessTokenHash;
		const rotated = hashCache.at > 0 && value !== hashCache.value;
		hashCache = { at: Date.now(), value };
		// Rotation (or removal) invalidates every remote cookie, so remote sockets must not outlive it.
		if (rotated) revoke("remote");
	};
	const accessHash = async () => {
		if (Date.now() - hashCache.at > 1000) await refreshHash();
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
	const cookieHeader = (req: IncomingMessage, login: Login, hash: string | undefined, mount: string) =>
		`${COOKIE}=${sessions.sign(login, hash)}; Path=${mount}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_TTL_MS / 1000}${
			secureFor(req.headers.host) ? "; Secure" : ""
		}`;

	/** Throttling key: the socket peer, or the first X-Forwarded-For hop when a loopback proxy is explicitly trusted. */
	function peerOf(req: IncomingMessage): string {
		const address = req.socket.remoteAddress ?? "unknown";
		if (trustProxy && isLoopback(address)) {
			const first = String(req.headers["x-forwarded-for"] ?? "")
				.split(",")[0]
				?.trim();
			if (first && first.length <= 64) return first;
		}
		return address;
	}

	/** Exchange a one-time ticket (and, only when `allowAccessToken`, the long-lived token) for a login kind. */
	async function exchange(
		req: IncomingMessage,
		token: string,
		allowAccessToken: boolean,
	): Promise<Login | "limited" | undefined> {
		// A valid one-time ticket on a loopback connection always works, so local recovery cannot be locked out.
		if (isLoopback(req.socket.remoteAddress) && tickets.consume(token)) return "local";
		const peer = peerOf(req);
		if (limiter.blocked(peer)) return "limited";
		if (tickets.consume(token)) return "local";
		if (allowAccessToken) {
			const hash = await accessHash();
			if (hash && safeEqual(tokenHash(token), hash)) return "remote";
		}
		limiter.fail(peer);
		return undefined;
	}

	const loopbackHost = (value: string | undefined) => value === `127.0.0.1:${port}` || value === `localhost:${port}`;
	/** Strip the public base path when present. Loopback hosts also serve at `/`; the cookie Path follows the mount used. */
	function route(req: IncomingMessage, rawPath: string): { pathname: string; mount: string } {
		const prefixed = basePath !== "/" && (rawPath === basePath.slice(0, -1) || rawPath.startsWith(basePath));
		const pathname = prefixed ? `/${rawPath.slice(basePath.length)}` : rawPath;
		return { pathname, mount: prefixed || !loopbackHost(req.headers.host) ? basePath : "/" };
	}
	const principalFor = (login: Login) => principalOf(login, settings.remoteOwner);
	const ctxFor = (login: Login): HostCtx => ({ ...host, principal: principalFor(login), gateway: handle });

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
			const def = registry.prepare(method, params, principalFor(login));
			if (def.stream) throw new MethodError("invalid_params", `${method} is a stream; use /api/stream`);
			sendJson(res, 200, { ok: true, result: await registry.call(method, params, ctxFor(login), abort.signal) });
		} catch (error) {
			const info = errorOf(error);
			sendJson(res, info.code === "forbidden" ? 403 : 200, { ok: false, error: info });
		}
	}

	const server: Server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://gateway.invalid");
			const { pathname, mount } = route(req, url.pathname);
			const api = pathname.startsWith("/api/");
			const write = req.method !== "GET" && req.method !== "HEAD";
			const refused = guard(req, api || write);
			if (refused) return fail(res, 403, "forbidden", refused);

			if (pathname === "/login") {
				if (req.method === "GET") return send(res, 200, loginPage(mount), "text/html; charset=utf-8");
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
				const login = typeof token === "string" && token ? await exchange(req, token, true) : undefined;
				if (login === "limited") return fail(res, 429, "unavailable", "too many attempts; wait a minute");
				if (!login) {
					if (json) return fail(res, 401, "forbidden", "invalid token");
					return send(res, 401, loginPage(mount, "令牌无效 · Invalid token"), "text/html; charset=utf-8");
				}
				const cookie = {
					"Set-Cookie": cookieHeader(req, login, login === "remote" ? await accessHash() : undefined, mount),
				};
				if (json) return sendJson(res, 200, { ok: true, result: { kind: principals[login].kind } }, cookie);
				return redirect(res, mount, cookie);
			}

			if (pathname === "/api/logout" && req.method === "POST") {
				return sendJson(
					res,
					200,
					{ ok: true, result: {} },
					{
						"Set-Cookie": `${COOKIE}=; Path=${mount}; HttpOnly; SameSite=Strict; Max-Age=0`,
					},
				);
			}

			// `?token=` on any page: one-time tickets only (URLs end up in logs); the access token goes through POST /login.
			const queryToken = url.searchParams.get("token");
			if (queryToken && req.method === "GET" && !api) {
				const login = await exchange(req, queryToken, false);
				if (login === "limited") return fail(res, 429, "unavailable", "too many attempts; wait a minute");
				if (!login) return redirect(res, `${mount}login`);
				return redirect(res, mount, { "Set-Cookie": cookieHeader(req, login, undefined, mount) });
			}

			const login = await loginOf(req);
			if (!login) {
				if (api) return fail(res, 401, "forbidden", "login required");
				return redirect(res, `${mount}login`);
			}

			if (pathname.startsWith("/api/rpc/")) {
				if (req.method !== "POST") return fail(res, 405, "invalid_params", "use POST");
				return await handleRpc(req, res, decodeURIComponent(pathname.slice("/api/rpc/".length)), login);
			}
			if (api) return fail(res, 404, "not_found", "unknown endpoint");
			if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "invalid_params", "method not allowed");
			if (await serveStatic(res, staticDir, pathname, mount)) return;
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
	/** Every open socket with the credential it was admitted under; re-checked on each frame. */
	const sockets = new Map<WebSocket, { login: Login; exp: number; hash: string | undefined }>();
	function revoke(login: Login) {
		for (const [ws, auth] of sockets) if (auth.login === login) ws.close(4401, "credentials revoked");
	}

	server.on("upgrade", async (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const reject = (status: number, text: string) => {
			socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
			socket.destroy();
		};
		try {
			const url = new URL(req.url ?? "/", "http://gateway.invalid");
			if (route(req, url.pathname).pathname !== "/api/stream") return reject(404, "Not Found");
			if (guard(req, true)) return reject(403, "Forbidden");
			if (url.searchParams.get("v") && url.searchParams.get("v") !== "1") return reject(426, "Upgrade Required");
			const hash = await accessHash();
			const session = sessions.inspect(cookieValue(req.headers.cookie, COOKIE), hash);
			if (!session) return reject(401, "Unauthorized");
			if (sockets.size >= MAX_SOCKETS) return reject(503, "Service Unavailable");
			wss.handleUpgrade(req, socket, head, (ws) => connection(ws, session.login, session.exp, hash));
		} catch {
			reject(500, "Internal Server Error");
		}
	});

	function connection(ws: WebSocket, login: Login, exp: number, hash: string | undefined) {
		sockets.set(ws, { login, exp, hash });
		const expiry = setTimeout(() => ws.close(4401, "session expired"), Math.max(0, exp - Date.now()));
		expiry.unref();
		const stale = () => Date.now() >= exp || (login === "remote" && hashCache.value !== hash);
		const principal: Principal = principalFor(login);
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
			// Until the feed is joined, cancelling (unsub or socket close) only sets this flag.
			let cancelled = false;
			subs.set(sub, () => {
				cancelled = true;
			});
			try {
				const def = registry.prepare(method, params ?? {}, principal);
				if (!def.stream) throw new MethodError("invalid_params", `${method} is not a stream method`);
				if (!def.stream.resumable && after !== undefined)
					throw new MethodError("invalid_params", `${method} does not accept after`);
				const feed = await feeds.acquire(method, params ?? {}, ctxFor(login));
				if (cancelled) {
					feed.release();
					return;
				}
				let ready = false;
				let overflow = false;
				const queue: FeedEvent[] = [];
				let n = 0;
				const eventType = def.stream.type;
				const emit = (event: FeedEvent) => {
					const mapped = mapEvent(eventType, event.data);
					if (!mapped) return;
					frame({
						t: "ev",
						sub,
						seq: ++n,
						cursor: feed.resumable ? `${feed.epoch}:${event.seq}` : "",
						type: mapped.type,
						ts: event.ts,
						data: mapped.data,
					});
				};
				// Synchronously decide replay vs fresh and start listening, so no event falls between the two.
				const covered = feed.seq;
				const replay = typeof after === "string" && after ? feed.replay(after) : undefined;
				const listener: Listener = {
					push(event) {
						if (event.seq <= covered) return;
						if (ready) emit(event);
						else if (queue.length < QUEUE_MAX) queue.push(event);
						else overflow = true;
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
						result = await sessionSnapshot((params as { id: string }).id, ctxFor(login));
					}
					if (method === "views.watch")
						result = await registry.call("views.list", params ?? {}, ctxFor(login), new AbortController().signal);
				}
				if (!subs.has(sub)) return;
				// The snapshot was read after the cursor was captured and carries no revision, so events that arrived
				// meanwhile may or may not be in it: flag a gap (client reconciles) and still deliver them afterwards.
				const arrived = queue.length > 0 || overflow;
				frame({
					t: "ready",
					sub,
					gap: feed.resumable ? (typeof after === "string" && after !== "" && !resumed) || arrived : true,
					cursor: feed.resumable ? `${feed.epoch}:${covered}` : "",
					result,
				});
				for (const event of replay ?? []) if (event.seq <= covered) emit(event);
				ready = true;
				// On overflow the queue is incomplete; the ring (when it still holds them) supplies the rest.
				const missed = overflow ? (feed.replay(`${feed.epoch}:${covered}`) ?? []) : queue;
				for (const event of missed) emit(event);
			} catch (error) {
				subs.get(sub)?.();
				subs.delete(sub);
				const info = errorOf(error);
				end(sub, info.code === "forbidden" ? "forbidden" : "error", info);
			}
		}

		ws.on("message", (raw) => {
			lastSeen = Date.now();
			if (stale()) return ws.close(4401, "session expired");
			let msg: { t?: unknown; sub?: unknown; method?: unknown; params?: unknown; after?: unknown; n?: unknown };
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return ws.close(1003, "invalid frame");
			}
			// Valid JSON is not necessarily a frame: `null`, numbers and arrays must not reach property reads.
			if (typeof msg !== "object" || msg === null || Array.isArray(msg) || typeof msg.t !== "string")
				return ws.close(1003, "invalid frame");
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
			clearTimeout(expiry);
			sockets.delete(ws);
			for (const dispose of subs.values()) dispose();
			subs.clear();
		});
		ws.on("error", () => ws.terminate());
	}

	mountRoutes(server, host);

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

	await refreshHash();
	const rotation = setInterval(() => void refreshHash().catch(() => {}), 1000);
	rotation.unref();

	const handle: GatewayHandle = {
		port,
		stats: () => ({ sockets: sockets.size, feeds: feeds.size }),
		ticket() {
			const ticket = tickets.issue();
			return { token: ticket.token, expiresAt: new Date(ticket.expiresAt).toISOString(), port, basePath };
		},
		async close() {
			clearInterval(rotation);
			for (const ws of sockets.keys()) {
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
