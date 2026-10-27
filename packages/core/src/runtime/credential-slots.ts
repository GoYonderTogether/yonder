import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthOperationOptions, Credential, CredentialStore } from "@earendil-works/pi-ai";
import { FileAuthStorageBackend, FileCredentials } from "./credentials.js";

export type CredentialSlots = Readonly<Record<string, string>>;
export type SlotSource = { kind: "stored" } | { kind: "env-ref"; variable: string };
interface Descriptor {
	version: 1;
	generation: string;
	removed: boolean;
	source: SlotSource;
}
export interface SlotMetadata {
	provider: string;
	slot: string;
	configured: boolean;
	type?: Credential["type"];
	sourceKind: SlotSource["kind"];
}
export interface LoginTicket {
	provider: string;
	slot: string;
	generation: string;
	replace: boolean;
}

export function validateSlotPart(value: string): void {
	if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) || ["constructor", "prototype", "__proto__"].includes(value))
		throw new Error("Invalid provider or credential slot name");
}
function descriptor(content: string | undefined): Descriptor | undefined {
	if (!content || content === "{}") return undefined;
	let value: Descriptor;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error("Invalid credential slot descriptor");
	}
	if (
		value.version !== 1 ||
		typeof value.generation !== "string" ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.generation) ||
		typeof value.removed !== "boolean" ||
		!value.source ||
		!["stored", "env-ref"].includes(value.source.kind) ||
		(value.source.kind === "env-ref" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.source.variable))
	)
		throw new Error("Invalid credential slot descriptor");
	return value;
}

/** Sidecar metadata and per-slot secrets share this outer lock. Refresh never changes account generation. */
export class CredentialSlotStore {
	readonly defaults: FileCredentials;
	constructor(readonly authPath: string) {
		this.defaults = new FileCredentials(authPath);
	}
	private paths(provider: string, slot: string) {
		validateSlotPart(provider);
		validateSlotPart(slot);
		const directory = resolve(`${this.authPath}.slots`, provider);
		return {
			metadata: resolve(directory, `${slot}.meta.json`),
			secrets: slot === "default" ? this.authPath : resolve(directory, `${slot}.auth.json`),
		};
	}
	private backend(provider: string, slot: string) {
		const paths = this.paths(provider, slot);
		for (const directory of [`${this.authPath}.slots`, resolve(`${this.authPath}.slots`, provider)]) {
			try {
				const stat = lstatSync(directory);
				if (
					!stat.isDirectory() ||
					stat.isSymbolicLink() ||
					stat.uid !== process.getuid?.() ||
					(stat.mode & 0o777) !== 0o700
				)
					throw new Error("Unsafe credential slot directory");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
		return new FileAuthStorageBackend(paths.metadata, true);
	}
	private secrets(provider: string, slot: string) {
		return slot === "default" ? this.defaults : new FileCredentials(this.paths(provider, slot).secrets, true);
	}
	async create(
		provider: string,
		slot: string,
		source: SlotSource = { kind: "stored" },
		options?: AuthOperationOptions,
	): Promise<void> {
		if (slot === "default" && source.kind !== "stored")
			throw new Error("Default slot does not support environment references");
		// Validate the complete descriptor before creating any files.
		const next: Descriptor = { version: 1, generation: randomUUID(), removed: false, source };
		descriptor(JSON.stringify(next));
		await this.backend(provider, slot).withLockAsync(async (content) => {
			const current = descriptor(content);
			if (current && !current.removed) throw new Error("Credential slot already exists");
			return { result: undefined, next: JSON.stringify(next) };
		}, options);
	}
	async beginLogin(
		provider: string,
		slot: string,
		replace = false,
		options?: AuthOperationOptions,
	): Promise<LoginTicket> {
		return this.backend(provider, slot).withLockAsync(async (content) => {
			let current = descriptor(content);
			const credential = await this.secrets(provider, slot).read(provider, options);
			if (credential && !replace) throw new Error("Credential already exists; replacement must be explicit");
			if (!current || current.removed)
				current = { version: 1, generation: randomUUID(), removed: false, source: { kind: "stored" } };
			if (current.source.kind !== "stored") throw new Error("Login requires a stored credential slot");
			return { result: { provider, slot, generation: current.generation, replace }, next: JSON.stringify(current) };
		}, options);
	}
	async commitLogin(ticket: LoginTicket, credential: Credential, options?: AuthOperationOptions): Promise<void> {
		const waiting = new AbortController();
		const cancel = () => waiting.abort(options?.signal?.reason);
		options?.signal?.addEventListener("abort", cancel, { once: true });
		if (options?.signal?.aborted) cancel();
		try {
			await this.backend(ticket.provider, ticket.slot).withLockAsync(
				async (content, persist) => {
					const current = descriptor(content);
					if (!current || current.removed || current.generation !== ticket.generation)
						throw new Error("Credential account changed during login; result not saved");
					await this.secrets(ticket.provider, ticket.slot).modify(
						ticket.provider,
						async (existing) => {
							options?.signal?.throwIfAborted();
							if (existing && !ticket.replace) throw new Error("Credential already exists; result not saved");
							// Commit has entered the secret lock: complete persistence and report the actual result.
							options?.signal?.removeEventListener("abort", cancel);
							current.generation = randomUUID();
							persist(JSON.stringify(current));
							return credential;
						},
						{ signal: waiting.signal },
					);

					return { result: undefined, next: JSON.stringify(current) };
				},
				{ signal: waiting.signal },
			);
		} finally {
			options?.signal?.removeEventListener("abort", cancel);
		}
	}

	async remove(provider: string, slot: string, options?: AuthOperationOptions): Promise<void> {
		await this.backend(provider, slot).withLockAsync(async (content, persist) => {
			const current = descriptor(content);
			persist(
				JSON.stringify({
					version: 1,
					generation: randomUUID(),
					removed: true,
					source: current?.source ?? { kind: "stored" },
				}),
			);
			await this.secrets(provider, slot).delete(provider, options);
			return { result: undefined };
		}, options);
	}

	async status(provider: string, slot: string, options?: AuthOperationOptions): Promise<SlotMetadata> {
		return this.backend(provider, slot).withLockAsync(async (content) => {
			const current = descriptor(content);
			if (slot !== "default" && (!current || current.removed))
				throw new Error(`Unknown credential slot: ${provider}/${slot}`);
			const credential = await this.secrets(provider, slot).read(provider, options);
			return {
				result: {
					provider,
					slot,
					configured: current?.source.kind === "env-ref" || !!credential,
					...(credential ? { type: credential.type } : {}),
					sourceKind: current?.source.kind ?? "stored",
				},
			};
		}, options);
	}
	async list(): Promise<SlotMetadata[]> {
		const result: SlotMetadata[] = [];
		// Default entries retain the old provider and named-secret namespace; only registered sidecars are slots.
		const root = `${this.authPath}.slots`;
		if (!existsSync(root)) return result;
		for (const provider of readdirSync(root)) {
			validateSlotPart(provider);
			for (const name of readdirSync(resolve(root, provider))) {
				if (!name.endsWith(".meta.json")) continue;
				const slot = name.slice(0, -10);
				const metadata = await this.backend(provider, slot).withLockAsync(async (content) => ({
					result: descriptor(content),
				}));
				if (metadata && !metadata.removed) result.push(await this.status(provider, slot));
			}
		}
		return result;
	}
	/** Non-secret account generations persisted in the run snapshot before the first request. */
	async capture(selection: CredentialSlots): Promise<Record<string, string>> {
		const generations: Record<string, string> = {};
		for (const [provider, slot] of Object.entries(selection)) {
			if (slot === "default") continue;
			generations[provider] = await this.backend(provider, slot).withLockAsync(async (content) => {
				const current = descriptor(content);
				if (!current || current.removed) throw new Error(`Unknown credential slot: ${provider}/${slot}`);
				return { result: current.generation };
			});
		}
		return generations;
	}
	/** Immutable selection; unknown or removed named slots always fail, including at refresh time. */
	bind(selection: CredentialSlots = {}, generations: Readonly<Record<string, string>> = {}): CredentialStore {
		const pinned = { ...generations };
		const slots = Object.freeze({ ...selection });
		for (const [provider, slot] of Object.entries(slots)) this.paths(provider, slot);
		const access = async <T>(
			provider: string,
			options: AuthOperationOptions | undefined,
			fn: (store: FileCredentials, current: Descriptor) => Promise<T>,
		): Promise<T> => {
			const slot = slots[provider] ?? "default";
			if (slot === "default")
				return fn(this.defaults, { version: 1, generation: "default", removed: false, source: { kind: "stored" } });
			return this.backend(provider, slot).withLockAsync(async (content) => {
				const current = descriptor(content);
				if (!current || current.removed) throw new Error(`Unknown credential slot: ${provider}/${slot}`);
				if (pinned[provider] !== undefined && pinned[provider] !== current.generation)
					throw new Error("Credential account changed; frozen run cannot use its replacement");
				pinned[provider] = current.generation;
				return { result: await fn(this.secrets(provider, slot), current) };
			}, options);
		};
		return {
			read: (provider, options) =>
				access(provider, options, async (store, current) => {
					if (current.source.kind === "env-ref") {
						const key = process.env[current.source.variable];
						if (!key) throw new Error("Credential slot environment reference is not configured");
						return { type: "api_key", key };
					}
					const value = await store.read(provider, options);
					if ((slots[provider] ?? "default") !== "default" && !value)
						throw new Error(`Credential slot is not configured: ${provider}/${slots[provider]}`);
					return value;
				}),
			modify: (provider, fn, options) =>
				access(provider, options, async (store, current) => {
					if (current.source.kind !== "stored") throw new Error("Environment reference slots cannot be modified");
					return store.modify(provider, fn, options);
				}),
			delete: (provider, options) => this.remove(provider, slots[provider] ?? "default", options),
			list: async (options) => {
				const result = [...(await this.defaults.list(options))].filter(
					(item) => !slots[item.providerId] || slots[item.providerId] === "default",
				);
				for (const [provider, slot] of Object.entries(slots)) {
					if (slot === "default") continue;
					const metadata = await this.status(provider, slot, options);
					if (metadata.configured) result.push({ providerId: provider, type: metadata.type ?? "api_key" });
				}
				return result;
			},
		};
	}
}
