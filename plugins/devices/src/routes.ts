import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity, connect, type TLSSocket } from "node:tls";
import { type RelayFrame, RelayFrameSchema, type SignedEnvelope } from "@yonder/sdk";
import { Check } from "typebox/value";
import { WebSocket } from "ws";

const maximum = 1_500_000;
function endpoint(value: string, allowLoopback: boolean): URL {
	const url = new URL(value);
	if (url.username || url.password || url.hash || url.search)
		throw new Error("Route URL must not contain credentials, query or fragment");
	if (
		url.protocol !== "https:" &&
		!(allowLoopback && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname))
	)
		throw new Error("Execution routes require HTTPS; explicit HTTP is restricted to loopback tests");
	return url;
}

async function pinnedSocket(url: URL, pin: string, signal: AbortSignal): Promise<TLSSocket> {
	return new Promise((resolve, reject) => {
		const host = url.hostname.replace(/^\[|\]$/g, "");
		const socket = connect({
			host,
			port: Number(url.port || 443),
			...(isIP(host) ? {} : { servername: host }),
			rejectUnauthorized: false,
		});
		const abort = () => socket.destroy(new Error("Direct TLS handshake aborted"));
		signal.addEventListener("abort", abort, { once: true });
		socket.once("close", () => signal.removeEventListener("abort", abort));
		if (signal.aborted) abort();
		socket.once("error", reject);
		socket.once("secureConnect", () => {
			const certificate = socket.getPeerCertificate();
			if (
				!certificate.raw ||
				createHash("sha256").update(certificate.raw).digest("hex") !== pin ||
				checkServerIdentity(host, certificate)
			) {
				socket.destroy();
				reject(new Error("Direct TLS endpoint fingerprint/hostname mismatch"));
				return;
			}
			resolve(socket);
		});
	});
}

async function post(
	url: URL,
	body: unknown,
	signal: AbortSignal,
	headers: Record<string, string> = {},
	pin?: string,
): Promise<unknown> {
	signal.throwIfAborted();
	const socket = pin ? await pinnedSocket(url, pin, signal) : undefined;
	return new Promise((resolve, reject) => {
		const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
			url,
			{
				method: "POST",
				signal,
				headers: { "content-type": "application/json", ...headers },
				...(socket ? { createConnection: () => socket } : {}),
			},
			(response) => {
				const chunks: Buffer[] = [];
				let length = 0;
				response.on("data", (chunk: Buffer) => {
					length += chunk.length;
					if (length > maximum) response.destroy(new Error("Oversized execution response"));
					else chunks.push(chunk);
				});
				response.once("error", reject);
				response.once("end", () => {
					if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
						reject(new Error(`Execution HTTP status ${response.statusCode}`));
						return;
					}
					try {
						resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
					} catch {
						reject(new Error("Invalid execution JSON response"));
					}
				});
			},
		);
		request.once("error", reject);
		request.end(JSON.stringify(body));
	});
}

export function directRoute(config: { url: string; tlsFingerprint?: string }, allowLoopback = false) {
	const url = endpoint(config.url, allowLoopback);
	if (url.protocol === "https:" && !/^[a-f0-9]{64}$/.test(config.tlsFingerprint ?? ""))
		throw new Error("Direct HTTPS requires the explicitly verified endpoint certificate SHA-256");
	return {
		kind: "direct" as const,
		exchange: (envelope: SignedEnvelope, signal: AbortSignal) => post(url, envelope, signal, {}, config.tlsFingerprint),
	};
}

/** One socket per configured Card peer. No timers/reconnects/replays outside a tool call. */
export class CardRoute {
	readonly kind = "card" as const;
	private readonly base: URL;
	private socket: WebSocket | undefined;
	private connecting: Promise<WebSocket> | undefined;
	private stopped = false;
	private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
	constructor(
		private readonly config: { baseUrl: string; peerDeviceId: string },
		private readonly token: () => Promise<string>,
		allowLoopback = false,
	) {
		this.base = endpoint(config.baseUrl, allowLoopback);
		if (this.base.pathname !== "/") throw new Error("Card baseUrl must be an origin");
	}
	private fail(error: Error): void {
		for (const p of this.pending.values()) p.reject(error);
		this.pending.clear();
	}
	private async open(signal: AbortSignal): Promise<WebSocket> {
		if (this.stopped) throw new Error("Device connections stopped");
		if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
		if (this.connecting) return this.connecting;
		this.connecting = (async () => {
			const token = await this.token();
			if (!token || /[\r\n]/.test(token)) throw new Error("Invalid Card device credential");
			const ticket = await post(
				new URL("/api/execution/ticket", this.base),
				{ targetDeviceId: this.config.peerDeviceId },
				signal,
				{ authorization: `Bearer ${token}` },
			);
			if (
				!ticket ||
				typeof ticket !== "object" ||
				!("ticket" in ticket) ||
				typeof ticket.ticket !== "string" ||
				!/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket)
			)
				throw new Error("Invalid single-use Card ticket response");
			const url = new URL("/ws/execution", this.base);
			url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(url, {
				headers: { authorization: `Bearer ${token}`, "x-execution-relay-ticket": ticket.ticket },
				handshakeTimeout: 15_000,
				maxPayload: 1_400_000,
				perMessageDeflate: false,
				followRedirects: false,
			});
			this.socket = socket;
			socket.on("error", () => {
				if (this.socket === socket) this.fail(new Error("Card execution connection failed"));
			});
			socket.once("close", () => {
				if (this.socket === socket) {
					this.socket = undefined;
					this.fail(new Error("Card execution connection closed"));
				}
			});
			socket.on("message", (raw, binary) => {
				try {
					if (binary) throw new Error("Binary relay message");
					const message = JSON.parse(raw.toString());
					if (message.error) {
						this.fail(new Error("Card execution relay rejected the frame or peer is offline"));
						return;
					}
					if (
						message.type !== "relay" ||
						message.sourceDeviceId !== this.config.peerDeviceId ||
						!Check(RelayFrameSchema, message.frame)
					)
						throw new Error("Unexpected Card execution relay source/frame");
					const frame = message.frame as RelayFrame;
					const pending = this.pending.get(frame.routeId);
					if (pending) {
						this.pending.delete(frame.routeId);
						pending.resolve(frame.envelope);
					}
				} catch {
					this.fail(new Error("Invalid Card execution relay message"));
				}
			});
			await new Promise<void>((resolve, reject) => {
				const abort = () => {
					socket.terminate();
					reject(new Error("Card execution handshake aborted"));
				};
				signal.addEventListener("abort", abort, { once: true });
				socket.once("open", () => {
					signal.removeEventListener("abort", abort);
					resolve();
				});
				socket.once("error", () => {
					signal.removeEventListener("abort", abort);
					reject(new Error("Card execution handshake failed"));
				});
				if (signal.aborted) abort();
			});
			if (this.stopped) {
				socket.terminate();
				throw new Error("Device connections stopped");
			}
			return socket;
		})();
		try {
			return await this.connecting;
		} finally {
			this.connecting = undefined;
		}
	}
	async exchange(envelope: SignedEnvelope, signal: AbortSignal): Promise<unknown> {
		const socket = await this.open(signal);
		signal.throwIfAborted();
		const routeId = randomUUID();
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.pending.delete(routeId);
				reject(new Error("Card execution request aborted; outcome may be unknown"));
			};
			const finish = (value: unknown, error?: Error) => {
				signal.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(value);
			};
			this.pending.set(routeId, { resolve: (value) => finish(value), reject: (error) => finish(undefined, error) });
			signal.addEventListener("abort", abort, { once: true });
			socket.send(
				JSON.stringify({
					type: "relay",
					targetDeviceId: this.config.peerDeviceId,
					frame: { protocol: "yonder.execution.relay", version: 1, routeId, envelope },
				}),
				(error) => {
					if (error) {
						this.pending.delete(routeId);
						finish(undefined, new Error("Card execution send failed; outcome may be unknown"));
					}
				},
			);
		});
	}
	async close(): Promise<void> {
		this.stopped = true;
		this.fail(new Error("Device connections stopped"));
		this.socket?.terminate();
	}
}
