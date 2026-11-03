import type { OutboundFrame } from "./frames.js";

export interface ConnectionOptions {
	endpoint: string;
	deviceToken: string;
	onFrame(raw: unknown): void;
	/** Called after the socket opens, before the first frame is sent. */
	onOpen?(): void;
	onClose?(reason: string): void;
	/** Frames taller than this are refused rather than buffered. */
	maxPayload?: number;
}

const FIRST_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/** Validate the endpoint the same way the Card channel does: an HTTP(S) origin, never a URL with credentials. */
export function cloudUrl(endpoint: string): URL {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error("Yonder endpoint must be an HTTP(S) origin without credentials");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("Yonder endpoint must be an HTTP(S) origin without credentials");
	if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
		throw new Error("Yonder endpoint requires HTTPS outside loopback");
	return url;
}

export function deviceSocketUrl(endpoint: string): string {
	const url = cloudUrl(endpoint);
	const socket = new URL("/ws/device", url);
	socket.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return socket.toString();
}

/**
 * One outbound `/ws/device` connection with exponential backoff. This never listens on a
 * port, never blocks plugin startup, and never replays a mutation: a lost socket only
 * reconnects, and the server's `agent_cursor` replay decides what is redelivered (spec 23 §2.1).
 */
export class CloudConnection {
	private socket: WebSocket | undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private delay = FIRST_DELAY_MS;
	private stopped = false;
	private open = false;

	constructor(private readonly options: ConnectionOptions) {}

	get connected(): boolean {
		return this.open;
	}

	/** Start connecting. Never throws: a bad endpoint closes the connection instead. */
	start(): void {
		if (this.stopped) return;
		this.connect();
	}

	private connect(): void {
		if (this.stopped) return;
		let url: string;
		try {
			url = deviceSocketUrl(this.options.endpoint);
		} catch {
			this.options.onClose?.("invalid endpoint");
			return;
		}
		let socket: WebSocket;
		try {
			// Node's global WebSocket accepts request options; `ws` is not a DSH dependency.
			socket = new WebSocket(url, {
				headers: { authorization: `Bearer ${this.options.deviceToken}` },
				maxPayload: this.options.maxPayload ?? 1_400_000,
			} as unknown as string[]);
		} catch {
			this.scheduleRetry();
			return;
		}
		this.socket = socket;
		socket.onopen = () => {
			if (this.stopped || this.socket !== socket) return;
			this.open = true;
			this.delay = FIRST_DELAY_MS;
			this.options.onOpen?.();
		};
		socket.onmessage = (event: MessageEvent) => {
			if (this.stopped || this.socket !== socket) return;
			if (typeof event.data !== "string") return;
			if (event.data.length > (this.options.maxPayload ?? 1_400_000)) return;
			const raw: unknown = event.data;
			this.options.onFrame(raw);
		};
		socket.onerror = () => {
			/* `close` follows; reconnect is decided there. */
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			this.socket = undefined;
			if (this.open) this.options.onClose?.("disconnected");
			this.open = false;
			this.scheduleRetry();
		};
	}

	private scheduleRetry(): void {
		if (this.stopped || this.retry) return;
		this.retry = setTimeout(() => {
			this.retry = undefined;
			this.connect();
		}, this.delay);
		// Do not hold the harness process open just to retry a background connection.
		this.retry.unref?.();
		this.delay = Math.min(MAX_DELAY_MS, this.delay * 2);
	}

	send(frame: OutboundFrame): boolean {
		const socket = this.socket;
		if (!socket || !this.open || socket.readyState !== 1) return false;
		try {
			socket.send(JSON.stringify(frame));
			return true;
		} catch {
			return false;
		}
	}

	stop(): void {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.retry = undefined;
		const socket = this.socket;
		this.socket = undefined;
		this.open = false;
		try {
			socket?.close();
		} catch {
			/* Already closed. */
		}
	}
}
