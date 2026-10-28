import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { RelayFrameSchema, type SignedEnvelope } from "@yonder/protocol";
import { Check } from "typebox/value";
import { WebSocket } from "ws";

export interface CardConnectionConfig {
	baseUrl: string;
	peerDeviceId: string;
	tokenFile: string;
	allowInsecureLoopback?: boolean;
}

/** Routing credential only: every incoming request still needs the executor's paired signature/grant. */
export class CardDaemonConnection {
	private readonly base: URL;
	private socket: WebSocket | undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private started = false;
	private delay = 1000;
	private readonly abort = new AbortController();
	constructor(
		private readonly config: CardConnectionConfig,
		private readonly handle: (envelope: unknown) => Promise<SignedEnvelope>,
		private readonly state: (state: "connected" | "disconnected") => void = () => {},
	) {
		this.base = new URL(config.baseUrl);
		if (
			this.base.username ||
			this.base.password ||
			this.base.search ||
			this.base.hash ||
			this.base.pathname !== "/" ||
			(this.base.protocol !== "https:" &&
				!(
					config.allowInsecureLoopback === true &&
					this.base.protocol === "http:" &&
					["127.0.0.1", "[::1]"].includes(this.base.hostname)
				)) ||
			!isAbsolute(config.tokenFile) ||
			!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(config.peerDeviceId)
		)
			throw new Error("INVALID_REQUEST");
	}
	start(): void {
		if (this.started || this.stopped) return;
		this.started = true;
		this.connect();
	}
	private connect(): void {
		void this.open().catch(() => this.reconnect());
	}
	private reconnect(): void {
		if (this.stopped || this.retry) return;
		this.state("disconnected");
		this.retry = setTimeout(() => {
			this.retry = undefined;
			this.connect();
		}, this.delay);
		this.delay = Math.min(30_000, this.delay * 2);
	}
	private async open(): Promise<void> {
		const token = readFileSync(this.config.tokenFile, "utf8").trim();
		if (!token || token.length > 128 || /\s/.test(token)) throw new Error("UNAUTHORIZED");
		const response = await fetch(new URL("/api/execution/ticket", this.base), {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]),
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ targetDeviceId: this.config.peerDeviceId }),
		});
		if (response.status !== 201) {
			await response.body?.cancel();
			throw new Error("UNAUTHORIZED");
		}
		let text = "";
		if (response.body)
			for await (const chunk of response.body) {
				text += Buffer.from(chunk).toString("utf8");
				if (text.length > 4096) {
					await response.body.cancel().catch(() => {});
					throw new Error("INVALID_REQUEST");
				}
			}
		const ticket: unknown = JSON.parse(text);
		if (
			!ticket ||
			typeof ticket !== "object" ||
			!("ticket" in ticket) ||
			typeof ticket.ticket !== "string" ||
			!/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket)
		)
			throw new Error("INVALID_REQUEST");
		if (this.stopped) return;
		const url = new URL("/ws/execution", this.base);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url, {
			headers: { authorization: `Bearer ${token}`, "x-execution-relay-ticket": ticket.ticket },
			handshakeTimeout: 10_000,
			maxPayload: 1_400_000,
			perMessageDeflate: false,
			followRedirects: false,
		});
		this.socket = socket;
		socket.on("error", () => {});
		socket.once("close", () => {
			if (this.socket === socket) {
				this.socket = undefined;
				this.reconnect();
			}
		});
		socket.once("open", () => {
			if (this.stopped) socket.terminate();
			else {
				this.delay = 1000;
				this.state("connected");
			}
		});
		socket.on("message", (raw, binary) => {
			void (async () => {
				if (binary || this.stopped || this.socket !== socket) throw new Error("INVALID_REQUEST");
				const message = JSON.parse(raw.toString());
				if (
					message.type !== "relay" ||
					message.sourceDeviceId !== this.config.peerDeviceId ||
					!Check(RelayFrameSchema, message.frame)
				)
					throw new Error("INVALID_REQUEST");
				const envelope = await this.handle(message.frame.envelope);
				// A lost connection never replays a request or transfers its reply to a new socket.
				if (!this.stopped && this.socket === socket && socket.readyState === WebSocket.OPEN)
					socket.send(
						JSON.stringify({
							type: "relay",
							targetDeviceId: this.config.peerDeviceId,
							frame: { ...message.frame, envelope },
						}),
					);
			})().catch(() => {
				/* Invalid/unpaired requests get no signed success response. */
			});
		});
	}
	close(): void {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.abort.abort();
		this.socket?.terminate();
	}
}
