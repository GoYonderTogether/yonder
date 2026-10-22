import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { MessageInData, PluginAPI, ToolContext, Trigger, YEvent } from "@yonder/sdk";
import { type FSWatcher, watch } from "chokidar";
import { stringify } from "yaml";
import { capture } from "./capture.js";
import type { Config } from "./config.js";
import { initialize, safePath } from "./files.js";
import { once } from "./manifest.js";
import { Store, type WriteContext } from "./store.js";

const exec = promisify(execFile);
export function pluginContext(signal: AbortSignal): ToolContext {
	return {
		agent: null,
		profile: "memory",
		session: "-",
		capabilities: ["read", "write", "admin"],
		signal,
	} as ToolContext;
}
export function writeContext(op: string, signal: AbortSignal): WriteContext {
	return { op, id: "-", by: "plugin:memory", session: "-", signal };
}
export async function owner(api: PluginAPI, config: Config, event?: YEvent) {
	return Boolean(
		event?.type === "message.in" &&
			event.from?.startsWith("acct:") &&
			(await api.identity.account(event.from))?.person === config.owner,
	);
}
export class Ingest {
	readonly store: Store;
	private lifetime = new AbortController();
	private watcher: FSWatcher | undefined;
	private timer: ReturnType<typeof setInterval> | undefined;
	private work: Promise<void> = Promise.resolve();
	private stable = new Map<string, { size: number; mtime: number; at: number }>();
	constructor(
		readonly api: PluginAPI,
		readonly config: Config,
		readonly errors: string[],
	) {
		this.store = new Store(config.root);
	}
	private problem(label: string) {
		this.errors.push(label);
	}
	async chat(event: YEvent) {
		if (
			this.config.capture?.enabled !== true ||
			!(this.config.capture?.channels ?? []).includes(event.from?.split(":")[1] ?? "") ||
			!(await owner(this.api, this.config, event))
		)
			return;
		const data = event.data as MessageInData;
		if ((!data.text?.trim() && !data.attachments?.length) || /^\/[a-z]/i.test(data.text ?? "")) return;
		const ctx = pluginContext(this.lifetime.signal);
		await once(this.store, `event:${event.id}`, writeContext("memory.chat", ctx.signal), async () => {
			let text = data.text ?? "";
			for (const attachment of data.attachments ?? []) {
				let copied = false;
				if (this.config.capture?.attachments !== false) {
					try {
						const path = attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri;
						const info = await lstat(path);
						if (
							!info.isSymbolicLink() &&
							info.isFile() &&
							info.size <= (this.config.capture?.maxAttachmentBytes ?? 26214400)
						) {
							const target = await safePath(
								this.config.root,
								`inbox/${randomUUID()}-${basename(attachment.name ?? path)}`,
							);
							await copyFile(path, target, constants.COPYFILE_EXCL);
							copied = true;
							await this.store.log(`inbox/${basename(target)}`, writeContext("memory.attachment", ctx.signal));
						}
					} catch {
						this.problem("Attachment unavailable; metadata retained");
					}
				}
				text += `\n附件: ${attachment.name ?? "file"} (${attachment.mime}, ${attachment.bytes ?? "unknown"})${copied ? " → inbox" : ""}`;
			}
			const result = await capture(
				this.config,
				this.store,
				{ text, when: event.ts },
				ctx,
				(e) => this.api.events.emit(e),
				{ source: "chat", ref: `(ref: ${event.from}; evt:${event.id})` },
			);
			return result.path;
		});
	}
	async process(path: string, emit: PluginAPI["events"]["emit"]) {
		const file = await safePath(this.config.root, `inbox/${path}`),
			info = await lstat(file);
		if (
			!info.isFile() ||
			info.isSymbolicLink() ||
			path.split("/").some((p) => p.startsWith(".")) ||
			/\.(part|crdownload|tmp)$/i.test(path)
		)
			return;
		if (info.size > (this.config.capture?.maxAttachmentBytes ?? 26214400))
			throw new Error("Inbox file exceeds configured size limit; original retained");
		const bytes = await readFile(file),
			sha = createHash("sha256").update(bytes).digest("hex"),
			ctx = writeContext("memory.inbox", this.lifetime.signal);
		await once(this.store, `inbox:${randomUUID()}`, ctx, async (state) => {
			if (state.hashes[sha]) {
				const target = `archive/duplicates/${randomUUID()}-${basename(path)}`;
				await mkdir(dirname(await safePath(this.config.root, target)), { recursive: true });
				await rename(file, await safePath(this.config.root, target));
				await this.store.log(target, ctx);
				return target;
			}
			const textType = /\.(md|markdown|txt)$/i.test(path),
				converterConfig = this.config.converter;
			if (!textType) {
				const pdf = /\.pdf$/i.test(path) && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
				const docx = /\.docx$/i.test(path) && bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
				if (!pdf && !docx) throw new Error("Unsupported or mismatched inbox file type; original retained");
			}
			if (!textType && !converterConfig) throw new Error("Converter not configured; original retained in inbox");
			let converted: string | undefined;
			if (!textType) {
				try {
					if (!converterConfig) throw new Error("Converter not configured");
					const converter = converterConfig;
					const result = await exec(converter.command, [...(converter.args ?? []), file], {
						signal: this.lifetime.signal,
						timeout: (converter.timeoutSeconds ?? 120) * 1000,
						maxBuffer: 64 * 1024 * 1024,
						killSignal: "SIGKILL",
					});
					if (!result.stdout.trim()) throw new Error();
					converted = result.stdout.normalize("NFKC");
				} catch {
					throw new Error("Conversion failed (exit/timeout/empty output); original retained in inbox");
				}
			}
			const month = new Date().toLocaleDateString("sv-SE", { timeZone: this.config.timezone }).slice(0, 7);
			const raw = `raw/${month}/${sha.slice(0, 8)}-${basename(path)}`;
			const target = await safePath(this.config.root, raw);
			await mkdir(dirname(target), { recursive: true });
			// Refuse to overwrite a pre-existing raw file, including a truncated-hash filename collision.
			try {
				await stat(target);
				throw new Error("Raw destination already exists; original retained");
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
			}
			let searchable = raw;
			if (converted !== undefined) {
				searchable = `${raw}.converted.md`;
				await this.store.ensure(
					searchable,
					`---\n${stringify({ origin: "external", source: basename(path), sha256: sha, converted: true })}---\n${converted}`,
					ctx,
				);
			}
			await rename(file, target);
			await this.store.log(raw, ctx);
			state.files[raw] = { origin: "external", sha256: sha };
			state.hashes[sha] = raw;
			await capture(this.config, this.store, { text: `→ ${searchable}` }, pluginContext(this.lifetime.signal), emit, {
				source: "inbox",
				ref: "(ref: plugin:memory)",
			});
			await emit({
				type: "memory.captured",
				from: "plugin:memory",
				conv: "conv:memory-inbox:default",
				data: {
					path: searchable,
					origin: "external",
					source: "inbox",
					sha256: sha,
					converted: converted !== undefined,
				},
			});
			return raw;
		});
	}
	async scan(emit: PluginAPI["events"]["emit"]) {
		for (const entry of await readdir(await safePath(this.config.root, "inbox"), {
			withFileTypes: true,
			recursive: true,
		})) {
			if (!entry.isFile()) continue;
			const path = join(entry.parentPath, entry.name),
				relative = path.slice((await safePath(this.config.root, "inbox")).length + 1);
			if (relative.split("/").some((p) => p.startsWith(".")) || /\.(part|crdownload|tmp)$/i.test(relative)) continue;
			const info = await stat(path),
				prior = this.stable.get(relative);
			if (prior && prior.size === info.size && prior.mtime === info.mtimeMs && Date.now() - prior.at >= 1000) {
				try {
					await this.process(relative, emit);
					this.stable.delete(relative);
				} catch (e) {
					this.problem((e as Error).message);
				}
			} else if (!prior || prior.size !== info.size || prior.mtime !== info.mtimeMs)
				this.stable.set(relative, { size: info.size, mtime: info.mtimeMs, at: Date.now() });
		}
	}
	trigger(): Trigger {
		return {
			id: "memory-inbox",
			start: async (io) => {
				await initialize(this.config.root);
				const enqueue = () => {
					this.work = this.work.then(() => this.scan(io.emit)).catch(() => this.problem("Inbox scan failed"));
				};
				const inbox = await safePath(this.config.root, "inbox");
				this.watcher = watch(inbox, {
					ignoreInitial: false,
					awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
					ignored: (path) => /\/\.[^/]+|\.(part|crdownload|tmp)$/i.test(path),
				});
				const changed = (path: string) => {
					this.work = this.work
						.then(() => this.process(relative(inbox, path), io.emit))
						.catch((e) => {
							if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.problem((e as Error).message);
						});
				};
				this.watcher
					.on("add", changed)
					.on("change", changed)
					.on("error", () => this.problem("Inbox watcher failed"));
				this.timer = setInterval(enqueue, (this.config.inbox?.rescanSeconds ?? 60) * 1000);
				this.timer.unref();
				enqueue();
			},
			stop: async () => {
				clearInterval(this.timer);
				await this.watcher?.close();
				this.lifetime.abort();
				await this.work;
			},
		};
	}
}
