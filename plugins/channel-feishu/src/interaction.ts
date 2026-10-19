import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type PluginAPI, parseRef, type YEvent } from "@yonder/sdk";
import type { FeishuApi } from "./client.js";
import { object, string } from "./protocol.js";

type Reaction = {
	chat: string;
	messageId: string;
	eventId: string;
	reactionId?: string;
	removing?: Promise<void>;
	adding?: Promise<void>;
};

export class FeishuInteraction {
	private readonly reactions = new Map<string, Reaction>();
	private readonly latest = new Map<string, { messageId: string; time: number }>();
	private readonly directory: string;
	private ready = false;
	private stopped = true;
	private saveTail: Promise<void> = Promise.resolve();
	constructor(
		private readonly id: string,
		private readonly client: FeishuApi,
		private readonly api: PluginAPI,
	) {
		this.directory = join(api.paths.data, id);
	}
	private fail(phase: string, error: unknown, messageId?: string): void {
		this.api.log.warn("Feishu reaction unavailable", {
			instance: this.id,
			phase,
			...(messageId ? { msg: messageId } : {}),
			error: this.client.safe(error),
		});
	}
	private save(): Promise<void> {
		const work = this.saveTail
			.catch(() => {})
			.then(async () => {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const file = join(this.directory, `reactions-${randomUUID()}.tmp`);
				await writeFile(
					file,
					JSON.stringify(
						[...this.reactions.values()]
							.filter((row) => row.reactionId)
							.map(({ chat, messageId, eventId, reactionId }) => ({ chat, messageId, eventId, reactionId })),
					),
					{ mode: 0o600 },
				);
				await rename(file, join(this.directory, "reactions.json"));
			});
		this.saveTail = work;
		return work;
	}
	async start(): Promise<void> {
		this.stopped = false;
		try {
			try {
				const rows: unknown = JSON.parse(await readFile(join(this.directory, "reactions.json"), "utf8"));
				if (!Array.isArray(rows)) throw new Error("Invalid Feishu reaction receipts");
				for (const value of rows) {
					const row = object(value);
					if (
						![row.chat, row.messageId, row.eventId, row.reactionId].every((field) => typeof field === "string" && field)
					)
						throw new Error("Invalid Feishu reaction receipt");
					const reaction = row as Reaction;
					this.reactions.set(reaction.messageId, reaction);
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			this.ready = true;
			await Promise.all([...this.reactions.values()].map((row) => this.remove(row)));
		} catch (error) {
			this.fail("startup", error);
		}
	}
	observeMessage(chat: string, messageId: string, time: number): void {
		if (time >= (this.latest.get(chat)?.time ?? 0)) this.latest.set(chat, { messageId, time });
	}
	async onInput(event: YEvent): Promise<void> {
		if (this.stopped || event.type !== "message.in" || !event.conv) return;
		try {
			const ref = parseRef(event.conv);
			if (ref.kind !== "conv" || ref.channel !== this.id) return;
		} catch {
			return;
		}
		const data = object(event.data);
		const originals = Array.isArray(data.originals) ? data.originals.map(object) : [data];
		const runnable = event.routes?.some((route) => route.wake === "run" && !route.dropped);
		const work: Promise<void>[] = [];
		for (const original of originals) {
			const messageId = string(original.messageId) || string(original.msgId);
			if (!messageId) continue;
			const timestamp = string(original.createdAt);
			const time = (timestamp ? Number(timestamp) || Date.parse(timestamp) : Date.parse(event.ts)) || 0;
			this.observeMessage(event.conv, messageId, time);
			if (!runnable || !this.ready || this.reactions.has(messageId)) continue;
			const row: Reaction = { chat: event.conv, messageId, eventId: event.id };
			this.reactions.set(messageId, row);
			row.adding = this.add(row);
			work.push(row.adding);
		}
		await Promise.all(work);
	}
	private async add(row: Reaction): Promise<void> {
		try {
			const result = await this.client.request(
				`/im/v1/messages/${encodeURIComponent(row.messageId)}/reactions`,
				"POST",
				{ reaction_type: { emoji_type: "Typing" } },
			);
			row.reactionId = string(object(result.data).reaction_id);
			if (!row.reactionId) throw new Error("Feishu reaction omitted reaction_id; outcome unknown");
			this.api.log.info("Feishu reaction added", {
				instance: this.id,
				phase: "reaction",
				msg: row.messageId,
				event: row.eventId,
				reaction: row.reactionId,
			});
			await this.save();
		} catch (error) {
			this.fail("add", error, row.messageId);
		}
	}
	private async remove(row: Reaction): Promise<void> {
		row.removing ??= (async () => {
			await row.adding;
			await this.removeConfirmed(row);
		})();
		await row.removing;
	}
	private async removeConfirmed(row: Reaction): Promise<void> {
		if (!row.reactionId) return;
		try {
			await this.client.request(
				`/im/v1/messages/${encodeURIComponent(row.messageId)}/reactions/${encodeURIComponent(row.reactionId)}`,
				"DELETE",
			);
			this.api.log.info("Feishu reaction removed", {
				instance: this.id,
				phase: "reaction",
				msg: row.messageId,
				event: row.eventId,
				reaction: row.reactionId,
			});
			this.reactions.delete(row.messageId);
			await this.save();
		} catch (error) {
			this.fail("remove", error, row.messageId);
		}
	}
	async beforeReply(target: string, sourceMessageId?: string, explicitReplyTo?: string): Promise<string | undefined> {
		await Promise.all([...this.reactions.values()].filter((row) => row.chat === target).map((row) => this.remove(row)));
		return (
			explicitReplyTo ||
			(sourceMessageId && this.latest.get(target)?.messageId && this.latest.get(target)?.messageId !== sourceMessageId
				? sourceMessageId
				: undefined)
		);
	}
	async onEnd(event: YEvent): Promise<void> {
		if (event.type !== "run.end" && event.type !== "channel.command.result") return;
		const data = object(event.data);
		const inputs = new Set(
			Array.isArray(data.inputs)
				? data.inputs.filter((value): value is string => typeof value === "string")
				: event.parent
					? [event.parent]
					: [],
		);
		await Promise.all(
			[...this.reactions.values()].filter((row) => inputs.has(row.eventId)).map((row) => this.remove(row)),
		);
	}
	async stop(): Promise<void> {
		this.stopped = true;
		await Promise.all([...this.reactions.values()].map((row) => this.remove(row)));
		await this.saveTail.catch((error: unknown) => this.fail("persist", error));
	}
}
