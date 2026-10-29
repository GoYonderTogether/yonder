import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChannelLoginResult, PluginAPI } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";
import { type Brand, begin, type Created, poll, saveApp } from "./onboarding.js";

interface Pending {
	deviceCode: string;
	url: string;
	expiresAt: number;
	domain: Brand;
	interval: number;
}

/** One-click app creation (device flow): `start` yields a single link, polling stores the credentials. */
export class FeishuRegistration {
	private pending: Pending | undefined;
	private last = "";
	private timer: ReturnType<typeof setTimeout> | undefined;
	constructor(
		private readonly options: {
			id: string;
			client: FeishuApi;
			api: PluginAPI;
			directory: string;
			fetcher: typeof fetch;
			signal: AbortSignal;
			/** Reconnect the transport once credentials exist. */
			restart(): Promise<void>;
		},
	) {
		if (!options.client.configured) this.adoptStored();
	}
	/** Credentials created by an earlier registration; the secret stays in the private data directory. */
	private adoptStored(): void {
		try {
			const saved = JSON.parse(readFileSync(join(this.options.directory, "app.json"), "utf8")) as Partial<Created>;
			if (saved.appId && saved.appSecret)
				this.options.client.adopt(saved.appId, saved.appSecret, saved.domain === "lark" ? "lark" : "feishu");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("Invalid Feishu app credential file; delete it and log in again");
		}
	}
	stop(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}
	private schedule(): void {
		const pending = this.pending;
		if (!pending || this.timer || this.options.signal.aborted) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.login("poll", this.options.signal)
				.then((result) => {
					if (result.status === "wait") this.schedule();
				})
				.catch((error: unknown) => {
					this.last = "error";
					this.options.api.log.warn("Feishu app registration failed", {
						instance: this.options.id,
						error: this.options.client.safe(error),
					});
				});
		}, pending.interval * 1000);
		this.timer.unref();
	}
	private waiting(): ChannelLoginResult {
		const pending = this.pending;
		return {
			status: "wait",
			instance: this.options.id,
			...(pending ? { qrcodeUrl: pending.url, expiresAt: new Date(pending.expiresAt).toISOString() } : {}),
		};
	}
	async login(action: "start" | "poll", signal: AbortSignal): Promise<ChannelLoginResult> {
		const { id, client, fetcher } = this.options;
		signal.throwIfAborted();
		if (client.configured && !this.pending) return { status: "already_configured", instance: id };
		if (action === "start") {
			if (!this.pending || this.pending.expiresAt <= Date.now()) {
				const next = await begin(fetcher, client.config.domain ?? "feishu", signal);
				this.pending = { ...next, domain: "feishu" };
				this.last = "wait";
			}
			this.schedule();
			return this.waiting();
		}
		const pending = this.pending;
		if (!pending) return { status: this.last || "expired", instance: id };
		if (pending.expiresAt <= Date.now()) {
			this.pending = undefined;
			this.last = "expired";
			return { status: "expired", instance: id };
		}
		const result = await poll(fetcher, pending.deviceCode, pending.domain, signal);
		if (result.status === "wait" || result.status === "slow_down") {
			pending.domain = result.domain;
			if (result.status === "slow_down") pending.interval = Math.min(pending.interval + 5, 60);
			return this.waiting();
		}
		this.pending = undefined;
		this.last = result.status;
		if (result.status !== "confirmed") return { status: result.status, instance: id };
		await saveApp(this.options.directory, result);
		client.adopt(result.appId, result.appSecret, result.domain);
		await this.options.restart();
		return { status: "confirmed", instance: id };
	}
}
