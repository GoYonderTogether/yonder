import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Attachment,
	acct,
	type Channel,
	type ChannelIO,
	type ChannelLoginResult,
	conv,
	type Delivery,
	type OutMessage,
	type OutputPart,
	type PluginAPI,
	parseRef,
	privatePath,
	writePrivateFile,
} from "@yonder/sdk";
import { checkedServerBase, createClient, type Item, type Message } from "./client.js";

export interface Config {
	person?: string | null;
	allowedUsers?: string[];
	credential?: string;
	peerId?: string;
	botId?: string;
	streaming?: boolean;
}
interface State {
	base: string;
	cursor: string;
	peer?: string;
	bot?: string;
	token?: string;
	person?: string | null;
	linked?: boolean;
	contexts: Record<string, string>;
	seen: Record<string, string>;
}
export async function privateWrite(file: string, value: unknown): Promise<void> {
	const temp = `${file}.${randomUUID()}.tmp`;
	await writePrivateFile(temp, JSON.stringify(value));
	await rename(temp, file);
	await chmod(file, 0o600);
}
export class IlinkChannel implements Channel {
	readonly kinds = ["dm"];
	readonly output: { stream: boolean; attachments: boolean };
	private readonly directory: string;
	private state: State = { base: "https://ilinkai.weixin.qq.com", cursor: "", contexts: {}, seen: {} };
	private readonly lifetime = new AbortController();
	private readonly client: ReturnType<typeof createClient>;
	private io: ChannelIO | undefined;
	private ready: Promise<void> | undefined;
	private saveTail = Promise.resolve();
	private sendTail: Promise<unknown> = Promise.resolve();
	private loginTail: Promise<unknown> = Promise.resolve();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private polling: Promise<void> | undefined;
	private failure: string | undefined;
	private lastPoll: string | undefined;
	private loginState: { qr: string; url: string; at: number; base: string } | undefined;
	private loginTimer: ReturnType<typeof setTimeout> | undefined;
	private loginPolling: Promise<void> | undefined;
	private loginStatus: string | undefined;
	private scheduleLogin(): void {
		if (this.lifetime.signal.aborted || !this.loginState || this.loginTimer) return;
		this.loginTimer = setTimeout(() => {
			this.loginTimer = undefined;
			this.loginPolling = this.login("poll", this.lifetime.signal)
				.then((result) => {
					this.loginStatus = result.status;
					if (["wait", "scaned", "scaned_but_redirect", "binded_redirect"].includes(result.status))
						this.scheduleLogin();
				})
				.catch(() => {
					this.loginStatus = "error";
					this.api.log.warn("iLink login polling failed", { instance: this.id });
				})
				.finally(() => {
					this.loginPolling = undefined;
				});
		}, 1000);
		this.loginTimer.unref();
	}

	constructor(
		readonly id: string,
		readonly config: Config,
		private readonly api: PluginAPI,
		private readonly defaultPerson: () => Promise<string | undefined>,
		options: { fetch?: typeof fetch; testBaseUrl?: string } = {},
	) {
		this.directory = join(api.paths.data, id);
		this.output = { stream: config.streaming !== false, attachments: true };
		this.client = createClient({
			...options,
			base: () => this.state.base,
			signal: this.lifetime.signal,
			token: async () => {
				if (!config.credential) return this.state.token;
				const value = await api.credentials.get(config.credential);
				return value?.type === "api_key" ? value.key : undefined;
			},
			saveMedia: async (bytes, name, mime) => {
				const file = join(
					this.directory,
					"media",
					`${randomUUID()}-${name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(-128)}`,
				);
				await mkdir(join(this.directory, "media"), { recursive: true, mode: 0o700 });
				await writeFile(file, bytes, { mode: 0o600 });
				return {
					kind: mime.startsWith("image/")
						? "image"
						: mime.startsWith("audio/")
							? "audio"
							: mime.startsWith("video/")
								? "video"
								: "file",
					uri: pathToFileURL(file).href,
					mime,
					name,
					bytes: bytes.byteLength,
				};
			},
		});
	}
	private initialize(): Promise<void> {
		this.ready ??= (async () => {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			await chmod(this.directory, 0o700);
			privatePath(this.directory, true);
			await this.defaultPerson(); // Reserves the first configured instance even before QR login.
			try {
				const saved: State = JSON.parse(await readFile(join(this.directory, "account.json"), "utf8"));
				if (typeof saved.cursor !== "string" || !saved.contexts || !saved.seen) throw new Error();
				checkedServerBase(saved.base);
				this.state = saved;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT")
					throw new Error("Invalid private iLink state; restore it before continuing");
			}
			if (this.config.credential && !this.state.peer) {
				if (!this.config.peerId || !this.config.botId) throw new Error("credential requires peerId and botId");
				this.state.peer = this.config.peerId;
				this.state.bot = this.config.botId;
				// Importing an existing token never grants owner identity.
				this.state.person = null;
				this.state.linked = true;
				await this.save();
			}
			if (this.state.peer && !this.state.linked) await this.link();
		})();
		return this.ready;
	}
	private save(): Promise<void> {
		const value = JSON.stringify(this.state);
		const next = this.saveTail
			.catch(() => {})
			.then(() => privateWrite(join(this.directory, "account.json"), JSON.parse(value)));
		this.saveTail = next;
		return next;
	}
	private async link(): Promise<void> {
		if (!this.state.peer) throw new Error("iLink pairing missing");
		if (this.state.person) {
			if (!(await this.api.identity.person(this.state.person)))
				throw new Error("Configured iLink person does not exist");
			const account = acct(this.id, this.state.peer);
			const current = await this.api.identity.account(account);
			if (current?.person && current.person !== this.state.person)
				throw new Error("iLink identity conflict; use identity management explicitly");
			if (!current?.person) await this.api.identity.link(account, this.state.person);
		}
		this.state.linked = true;
		await this.save();
	}
	async start(io: ChannelIO): Promise<void> {
		this.io = io;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		try {
			await this.initialize();
			this.schedule(0);
		} catch {
			this.failure = "ILINK_INITIALIZATION_FAILED";
			this.api.log.warn("iLink initialization failed", { instance: this.id });
		}
	}
	private schedule(delay: number): void {
		if (this.lifetime.signal.aborted || this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.polling = this.poll()
				.catch(() => {
					this.failure = "ILINK_POLL_FAILED";
				})
				.finally(() => {
					this.polling = undefined;
					this.schedule(this.failure ? 5000 : 1000);
				});
		}, delay);
		this.timer.unref();
	}
	async poll(): Promise<void> {
		await this.initialize();
		if (!this.state.peer || !this.state.linked || !this.io || this.lifetime.signal.aborted) return;
		const page = await this.client.request(
			"ilink/bot/getupdates",
			{ get_updates_buf: this.state.cursor, base_info: this.client.baseInfo },
			true,
			undefined,
			45000,
		);
		if (page.msgs !== undefined && !Array.isArray(page.msgs)) throw new Error("Invalid iLink message page");
		for (const message of (page.msgs ?? []) as Message[]) await this.receive(message);
		if (typeof page.get_updates_buf === "string") {
			this.state.cursor = page.get_updates_buf;
			await this.save();
		}
		this.lastPoll = new Date().toISOString();
		this.failure = undefined;
	}
	private async receive(message: Message): Promise<void> {
		const peer = message.from_user_id;
		if (
			!peer ||
			message.message_type !== 1 ||
			message.group_id ||
			(peer !== this.state.peer && !this.config.allowedUsers?.includes(peer))
		)
			return;
		if (message.to_user_id !== undefined && message.to_user_id !== this.state.bot) return;
		if (!message.message_id || !Number.isFinite(message.create_time_ms))
			throw new Error("iLink message identity/time missing");
		const key = `${peer}:${message.message_id}`;
		if (message.context_token) {
			this.state.contexts[peer] = message.context_token;
			await this.save();
		}
		if (this.state.seen[key]) return;
		const attachments: Attachment[] = [],
			text: string[] = [];
		let replyTo: string | undefined;
		for (const item of message.item_list ?? []) {
			if (item.type === 1) text.push(item.text_item?.text ?? "");
			if (item.type === 3 && item.voice_item?.text) text.push(`[微信附带转写，未经核对] ${item.voice_item.text}`);
			attachments.push(...(await this.client.download(item)));
			if (item.ref_msg) {
				replyTo ??= item.ref_msg.svr_id;
				text.push(
					`[引用 ${item.ref_msg.svr_id ?? ""}] ${item.ref_msg.title ?? ""} ${item.ref_msg.message_item?.text_item?.text ?? ""}`,
				);
				if (item.ref_msg.message_item) attachments.push(...(await this.client.download(item.ref_msg.message_item)));
			}
		}
		if (!text.join("").trim() && !attachments.length) text.push("[微信消息类型暂不支持]");
		// Native msgId uses the kernel admission ledger, including after an unknown receipt.
		const event = await this.io!.emit({
			type: "message.in",
			from: acct(this.id, peer),
			conv: conv(this.id, peer),
			data: {
				kind: "dm",
				text: text.join("\n"),
				msgId: message.message_id,
				createdAt: String(message.create_time_ms),
				...(replyTo ? { replyTo } : {}),
				...(attachments.length ? { attachments } : {}),
			},
		});
		this.state.seen[key] = event.id;
		await this.save();
	}
	login(action: "start" | "poll", signal: AbortSignal, verifyCode?: string): Promise<ChannelLoginResult> {
		const next = this.loginTail
			.catch(() => {})
			.then(async (): Promise<ChannelLoginResult> => {
				signal.throwIfAborted();
				await this.initialize();
				if (this.state.peer && action === "poll" && !this.loginState)
					return {
						status: "already_connected",
						instance: this.id,
						peer: this.state.peer!,
						person: this.state.person ?? null,
					};
				if (action === "start") {
					if (this.loginState && Date.now() - this.loginState.at < 300000) {
						this.scheduleLogin();
						return {
							status: "wait",
							instance: this.id,
							qrcodeUrl: this.loginState.url,
							expiresAt: new Date(this.loginState.at + 300000).toISOString(),
						};
					}
					const page = await this.client.request(
						"ilink/bot/get_bot_qrcode?bot_type=3",
						{ local_token_list: [] },
						false,
						undefined,
						undefined,
						signal,
					);
					if (typeof page.qrcode !== "string" || typeof page.qrcode_img_content !== "string")
						throw new Error("Invalid iLink QR response");
					this.loginState = { qr: page.qrcode, url: page.qrcode_img_content, at: Date.now(), base: this.state.base };
					this.loginStatus = "wait";
					this.scheduleLogin();
					return {
						status: "wait",
						instance: this.id,
						qrcodeUrl: page.qrcode_img_content,
						expiresAt: new Date(Date.now() + 300000).toISOString(),
					};
				}
				const pending = this.loginState;
				if (!pending || Date.now() - pending.at > 300000) {
					this.loginState = undefined;
					this.loginStatus = "expired";
					return { status: "expired", instance: this.id };
				}
				const suffix = verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : "";
				const page = await this.client.request(
					`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(pending.qr)}${suffix}`,
					undefined,
					false,
					pending.base,
					undefined,
					signal,
				);
				if (page.status !== "confirmed") {
					if (page.status === "expired") {
						this.loginState = undefined;
						this.loginStatus = "expired";
					}
					if (page.status === "scaned_but_redirect" && typeof page.redirect_host === "string")
						pending.base = checkedServerBase(`https://${page.redirect_host}`);
					return {
						status: [
							"wait",
							"scaned",
							"expired",
							"need_verifycode",
							"verify_code_blocked",
							"binded_redirect",
							"scaned_but_redirect",
						].includes(String(page.status))
							? page.status
							: "unknown",
						instance: this.id,
					};
				}
				if (
					typeof page.ilink_bot_id !== "string" ||
					typeof page.ilink_user_id !== "string" ||
					typeof page.bot_token !== "string" ||
					!page.bot_token
				)
					throw new Error("Invalid iLink login identity");
				if (this.state.peer && (this.state.peer !== page.ilink_user_id || this.state.bot !== page.ilink_bot_id))
					throw new Error("iLink account mismatch; existing pairing was preserved");
				const person = this.state.peer
					? (this.state.person ?? null)
					: this.config.person !== undefined
						? this.config.person
						: ((await this.defaultPerson()) ?? null);
				if (person && !(await this.api.identity.person(person)))
					throw new Error("Configured iLink person does not exist");
				this.state = {
					...this.state,
					base: typeof page.baseurl === "string" ? checkedServerBase(page.baseurl) : pending.base,
					peer: page.ilink_user_id,
					bot: page.ilink_bot_id,
					token: page.bot_token,
					person,
					linked: false,
				};
				await this.save();
				await this.link();
				this.loginState = undefined;
				this.loginStatus = "confirmed";
				if (this.loginTimer) {
					clearTimeout(this.loginTimer);
					this.loginTimer = undefined;
				}
				this.schedule(0);
				return {
					status: "confirmed",
					instance: this.id,
					peer: this.state.peer!,
					account: acct(this.id, this.state.peer!),
					person,
					contextAvailable: false,
				};
			});
		this.loginTail = next;
		return next;
	}
	send(target: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery> {
		const next = this.sendTail
			.catch(() => {})
			.then(async (): Promise<Delivery> => {
				let attempted = false,
					sent = 0;
				const id = `yonder-wechat-${randomUUID()}`;
				try {
					await this.initialize();
					signal?.throwIfAborted();
					this.lifetime.signal.throwIfAborted();
					const ref = parseRef(target);
					if ((ref.kind !== "acct" && ref.kind !== "conv") || ref.channel !== this.id)
						throw new Error("Target must belong to this iLink instance");
					const peer = ref.id;
					if (
						!this.state.peer ||
						!this.state.linked ||
						(peer !== this.state.peer && !this.config.allowedUsers?.includes(peer))
					)
						throw new Error("iLink target is not admitted");
					const token = this.state.contexts[peer];
					if (!token) throw new Error("ILINK_CONTEXT_MISSING: recipient must first message this bot");
					const outgoing: Item[] = [];
					const characters = Array.from(msg.text);
					for (let offset = 0; offset < characters.length; offset += 2000)
						outgoing.push({ type: 1, text_item: { text: characters.slice(offset, offset + 2000).join("") } });
					for (const attachment of msg.attachments ?? [])
						outgoing.push(await this.client.upload(attachment, peer, signal));
					if (!outgoing.length) throw new Error("Empty iLink message");
					for (let index = 0; index < outgoing.length; index++) {
						signal?.throwIfAborted();
						const item = outgoing[index]!;
						if (msg.replyTo && index === 0) Object.assign(item, { ref_msg: { svr_id: msg.replyTo } });
						attempted = true;
						await this.client.request(
							"ilink/bot/sendmessage",
							{
								msg: {
									from_user_id: "",
									to_user_id: peer,
									client_id: `${id}-${index + 1}`,
									message_type: 2,
									message_state: 2,
									context_token: token,
									item_list: [item],
								},
								base_info: this.client.baseInfo,
							},
							true,
							undefined,
							undefined,
							signal,
						);
						sent++;
					}
					return { ok: true, id };
				} catch (error) {
					const rejected =
						sent === 0 && error instanceof Error && /API request failed (?:ret=-?\d+|http=4\d\d)$/.test(error.message);
					return {
						ok: false,
						...(attempted && !rejected ? { uncertain: true, id } : {}),
						error: rejected
							? "ILINK_SEND_REJECTED"
							: attempted
								? `ILINK_DELIVERY_UNCERTAIN: ${sent} parts confirmed; do not resend`
								: error instanceof Error && /^(?:ILINK_|Target |iLink |Empty )/.test(error.message)
									? error.message
									: "ILINK_SEND_FAILED",
					};
				}
			});
		this.sendTail = next;
		return next;
	}
	async stream(
		target: string,
		output: AsyncIterable<OutputPart>,
		replyTo?: string,
		signal?: AbortSignal,
	): Promise<Delivery> {
		let text = "";
		for await (const part of output) {
			signal?.throwIfAborted();
			if (part.type === "final") text = part.text;
		}
		if (!text.trim() || text.trim() === "NO_REPLY") return { ok: true };
		return this.send(target, { text, ...(replyTo ? { replyTo } : {}) }, signal);
	}
	async status(): Promise<object> {
		const person = this.state.peer
			? ((await this.api.identity.account(acct(this.id, this.state.peer)))?.person ?? null)
			: null;
		return {
			instance: this.id,
			paired: Boolean(this.state.peer && this.state.linked),
			loginPending: Boolean(this.loginState),
			loginStatus: this.loginStatus ?? null,
			peer: this.state.peer ?? null,
			person,
			contextAvailable: Boolean(this.state.peer && this.state.contexts[this.state.peer]),
			lastPoll: this.lastPoll ?? null,
			error: this.failure ?? null,
			transport: "ilink-long-poll",
			groups: false,
			voiceOutput: "audio-file",
			audioInput: "silk-to-wav-or-original",
			stopped: this.lifetime.signal.aborted,
		};
	}
	async stop(): Promise<void> {
		this.lifetime.abort();
		if (this.timer) clearTimeout(this.timer);
		if (this.loginTimer) clearTimeout(this.loginTimer);
		this.loginState = undefined;
		await Promise.allSettled([this.polling, this.sendTail, this.loginTail, this.loginPolling, this.saveTail]);
	}
}
