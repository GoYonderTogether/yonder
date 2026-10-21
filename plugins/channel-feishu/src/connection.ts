import * as Lark from "@larksuiteoapi/node-sdk";
import type { PluginAPI } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";

/** The official SDK owns initial connection retries, reconnects and their cancellation. */
export class FeishuConnection {
	readonly logger: Lark.Logger = {
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: (...values: unknown[]) => this.sdkLog(values),
		error: (...values: unknown[]) => this.sdkLog(values),
	};
	private ws: Lark.WSClient | undefined;
	private stopped = true;
	private state = "stopped";
	private error: string | undefined;
	constructor(
		private readonly id: string,
		private readonly client: FeishuApi,
		private readonly api: PluginAPI,
		private readonly onReady: () => void | Promise<void>,
	) {}
	status(): { state: string; error?: string; sdk?: Lark.WSConnectionStatus } {
		return {
			state: this.state,
			...(this.error ? { error: this.error } : {}),
			...(this.ws ? { sdk: this.ws.getConnectionStatus() } : {}),
		};
	}
	private diagnostic(phase: string, error: unknown): void {
		if (this.stopped) return;
		this.error = this.client.safe(error);
		this.api.log.warn("Feishu connection unavailable", { instance: this.id, phase, error: this.error });
	}
	private ready(): void {
		if (this.stopped) return;
		this.state = "connected";
		this.error = undefined;
		this.api.log.info("Feishu connected", { instance: this.id, phase: "websocket" });
		void Promise.resolve()
			.then(() => {
				if (!this.stopped) return this.onReady();
			})
			.catch((error: unknown) => this.diagnostic("ready", error));
	}
	async start(eventDispatcher: Lark.EventDispatcher): Promise<void> {
		this.stopped = false;
		this.state = "connecting";
		try {
			const credentials = await this.client.credentials();
			if (this.stopped) return;
			const http: Lark.HttpInstance = Object.create(Lark.defaultHttpInstance);
			const request = http.request.bind(http);
			http.request = async <T, R = T, D = unknown>(options: Lark.HttpRequestOptions<D>) => {
				try {
					return await request<T, R, D>(options);
				} catch (error) {
					this.diagnostic("endpoint", error);
					throw error;
				}
			};
			this.ws = new Lark.WSClient({
				...credentials,
				domain: this.client.config.domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
				autoReconnect: true,
				httpInstance: http,
				logger: this.logger,
				onReady: () => this.ready(),
				onReconnected: () => this.ready(),
				onReconnecting: () => {
					if (!this.stopped) this.state = "reconnecting";
				},
				onError: (error) => {
					if (this.stopped) return;
					this.state = "connection-error";
					this.diagnostic("websocket", error);
				},
			});
			await this.ws.start({ eventDispatcher });
			if (!this.stopped && this.ws.getConnectionStatus().state === "idle") this.state = "not-ready";
		} catch (error) {
			if (this.stopped) return;
			this.state = "not-ready";
			this.diagnostic("initialization", error);
		}
	}
	private sdkLog(values: unknown[]): void {
		// SDK debug logs include a signed WebSocket URL; never forward them or request objects.
		const message = values
			.flat(1)
			.filter((value) => typeof value === "string" || value instanceof Error)
			.map((value) => this.client.safe(value))
			.join(" ");
		if (!message || this.stopped) return;
		if (!this.error) this.error = message;
		this.api.log.warn("Feishu SDK diagnostic", { instance: this.id, phase: "sdk", error: message });
	}
	stop(): void {
		this.stopped = true;
		this.state = "stopped";
		this.ws?.close({ force: true });
		this.ws = undefined;
	}
}
