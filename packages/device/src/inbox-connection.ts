import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
	attestationKey,
	type CloudAttestation,
	type Grant,
	type SignedEnvelope,
	verifyAttestation,
} from "@yonder/protocol";
import { WebSocket } from "ws";

export interface InboxConnectionConfig {
	baseUrl: string;
	tokenFile: string;
	allowInsecureLoopback?: boolean;
}

/** Frames the executor sends and accepts on its inbox connection (18 §3). */
export type InboxHandler = {
	/** A controller's signed request, with the cloud's attestation for this executor. */
	introduce(envelope: unknown, attestation: unknown, signal: AbortSignal): Promise<SignedEnvelope>;
	grants(): Grant[];
	revoke(grantId: string): void;
	allowance(botId: string, devices: string[] | null): void;
	/** The cloud told this executor which account/cloud device its token belongs to. */
	registered(identity: { ownerId: string; cloudDeviceId: string }): void;
	state(state: "connected" | "disconnected"): void;
	diagnostic(message: string): void;
};

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const granted = (value: unknown): string[] | null | undefined =>
	value === null
		? null
		: Array.isArray(value) && value.every((item) => typeof item === "string" && uuid.test(item))
			? (value as string[])
			: undefined;

/**
 * The executor's inbound relay connection. It is a transport only: the cloud introduces a
 * controller, and the executor still verifies the controller's signature and the cloud
 * attestation before issuing anything.
 */
export class CardInboxConnection {
	private readonly base: URL;
	private readonly key: Buffer;
	private socket: WebSocket | undefined;
	private retry: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private started = false;
	private delay = 1000;
	private readonly abort = new AbortController();
	private readonly token: string;
	constructor(
		private readonly config: InboxConnectionConfig,
		private readonly handler: InboxHandler,
		private readonly executorDeviceId: string,
		private readonly publicKey: string,
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
			!isAbsolute(config.tokenFile)
		)
			throw new Error("INVALID_REQUEST");
		this.token = readFileSync(config.tokenFile, "utf8").trim();
		if (!this.token || this.token.length > 128 || /\s/.test(this.token)) throw new Error("UNAUTHORIZED");
		this.key = attestationKey(this.token);
	}
	get running(): boolean {
		return this.started && !this.stopped;
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
		this.handler.state("disconnected");
		this.retry = setTimeout(() => {
			this.retry = undefined;
			this.connect();
		}, this.delay);
		this.delay = Math.min(30_000, this.delay * 2);
	}
	private async open(): Promise<void> {
		const response = await fetch(new URL("/api/execution/ticket", this.base), {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]),
			headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
			body: JSON.stringify({ inbox: true }),
		});
		if (response.status !== 201) {
			await response.body?.cancel();
			throw new Error("UNAUTHORIZED");
		}
		const ticket = (await response.json()) as { ticket?: unknown };
		if (typeof ticket.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket))
			throw new Error("INVALID_REQUEST");
		if (this.stopped) return;
		const url = new URL("/ws/execution", this.base);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url, {
			headers: { authorization: `Bearer ${this.token}`, "x-execution-relay-ticket": ticket.ticket },
			handshakeTimeout: 10_000,
			maxPayload: 1_400_000,
			perMessageDeflate: false,
			followRedirects: false,
		});
		const connection = new AbortController();
		this.socket = socket;
		socket.on("error", () => {});
		socket.once("close", () => {
			connection.abort();
			if (this.socket === socket) {
				this.socket = undefined;
				this.reconnect();
			}
		});
		socket.once("open", () => {
			if (this.stopped) {
				socket.terminate();
				return;
			}
			this.delay = 1000;
			this.handler.state("connected");
			this.send({
				type: "executor.hello",
				executorDeviceId: this.executorDeviceId,
				publicKey: this.publicKey,
			});
			this.send({ type: "grants", grants: this.handler.grants() });
		});
		socket.on("message", (raw, binary) => {
			void this.receive(socket, raw, binary, connection.signal).catch(() => {
				/* Malformed frames are dropped; the socket stays up for the next one. */
			});
		});
	}
	private send(frame: unknown): void {
		if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
	}
	private async receive(
		socket: WebSocket,
		raw: WebSocket.RawData,
		binary: boolean,
		signal: AbortSignal,
	): Promise<void> {
		if (binary || this.stopped || this.socket !== socket) return;
		const message = JSON.parse(raw.toString()) as Record<string, unknown>;
		if (message.type === "executor.registered") {
			const ownerId = message.ownerId;
			const cloudDeviceId = message.cloudDeviceId;
			if (typeof ownerId !== "string" || !uuid.test(ownerId)) return;
			if (typeof cloudDeviceId !== "string" || !uuid.test(cloudDeviceId)) return;
			this.handler.registered({ ownerId, cloudDeviceId });
			return;
		}
		if (message.type === "relay") {
			const attestation = this.attestation(message.attestation);
			const envelope = await this.handler.introduce(
				(message.frame as { envelope?: unknown } | undefined)?.envelope,
				attestation,
				signal,
			);
			this.send({
				type: "relay",
				targetDeviceId: message.sourceDeviceId,
				frame: { ...(message.frame as object), envelope },
			});
			return;
		}
		if (message.type === "grant.revoke") {
			const attestation = this.attestation(message.attestation);
			if (attestation.action !== "revoke" || typeof message.grantId !== "string") return;
			if (attestation.subject !== message.grantId) return;
			this.handler.revoke(message.grantId);
			this.send({ type: "grants", grants: this.handler.grants() });
			return;
		}
		if (message.type === "allow.policy") {
			const attestation = this.attestation(message.attestation);
			if (attestation.action !== "policy" || typeof message.botId !== "string") return;
			if (attestation.subject !== message.botId) return;
			const devices = granted(message.devices);
			if (devices === undefined) return;
			this.handler.allowance(message.botId, devices);
			this.send({ type: "grants", grants: this.handler.grants() });
		}
	}
	private attestation(value: unknown): CloudAttestation {
		return verifyAttestation(value, this.key, Date.now());
	}
	close(): void {
		this.stopped = true;
		if (this.retry) clearTimeout(this.retry);
		this.abort.abort();
		this.socket?.terminate();
	}
}
