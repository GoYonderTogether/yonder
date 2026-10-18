import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Channel, ChannelIO, PluginAPI } from "@yonder/sdk";
import { type Static, Type } from "typebox";
import { Releases, ReleasesConfig } from "./releases.js";
import { recoverUpdates } from "./updates.js";
import { Github, login, nativeId, object, type ObjectValue } from "./client.js";

export const Config = Type.Object(
	{
		repository: Type.String({ pattern: "^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" }),
		accounts: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
		labels: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
		releases: Type.Optional(ReleasesConfig),
		pollSeconds: Type.Optional(Type.Integer({ minimum: 15, maximum: 3600 })),
	},
	{ additionalProperties: false },
);
export type ConfigValue = Static<typeof Config>;
interface IssueCursor {
	emitted: boolean;
	comment: string;
}
interface State {
	repository: string;
	since: string;
	issues: Record<string, IssueCursor>;
}
export const marker = "<!-- yonder:channel-github:status -->";
export class GithubChannel implements Channel {
	readonly kinds = ["issue"];
	readonly output = { stream: false, attachments: false };
	readonly client: Github;
	state: "stopped" | "starting" | "ready" | "unavailable" = "stopped";
	failure: string | undefined;
	releaseFailure: string | undefined;
	private controller = new AbortController();
	private loop: Promise<void> | undefined;
	private wake: (() => void) | undefined;
	private self = "";
	private cursor: State;
	private file: string;
	private releases: Releases | undefined;
	constructor(
		readonly id: string,
		readonly config: ConfigValue,
		private api: PluginAPI,
	) {
		this.client = new Github(config.repository);
		if (config.releases) this.releases = new Releases(id, config.repository, config.releases, api);
		this.file = join(api.paths.data, `${id}.json`);
		this.cursor = { repository: config.repository, since: "1970-01-01T00:00:00.000Z", issues: {} };
	}
	conv(number: number): string {
		return `conv:${this.id}:${this.config.repository}:issue:${number}`;
	}
	admitted(issue: ObjectValue): boolean {
		if (issue.pull_request) return false;
		const labels = Array.isArray(issue.labels)
			? issue.labels.map((value) => (typeof value === "string" ? value : String(object(value).name)))
			: [];
		return this.config.labels.every((label) => labels.includes(label));
	}
	authorized(user: unknown): boolean {
		return this.config.accounts.some((account) => account.toLowerCase() === login(user));
	}
	async start(io: ChannelIO): Promise<void> {
		if (this.loop) return;
		this.state = "starting";
		this.controller = new AbortController();
		try {
			const value = JSON.parse(await readFile(this.file, "utf8")) as State;
			if (value.repository !== this.config.repository || !value.issues || !Number.isFinite(Date.parse(value.since)))
				throw new Error("Invalid GitHub cursor or repository changed; preserve the cursor and resolve configuration");
			for (const [id, cursor] of Object.entries(value.issues)) {
				if (
					!/^[1-9][0-9]*$/.test(id) ||
					typeof cursor.emitted !== "boolean" ||
					!/^(0|[1-9][0-9]*)$/.test(cursor.comment)
				)
					throw new Error("Invalid GitHub issue cursor; preserve file for diagnosis");
			}
			this.cursor = value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				this.unavailable(error);
				return;
			}
		}
		this.loop = this.pollLoop(io);
	}
	private unavailable(error: unknown): void {
		this.state = "unavailable";
		this.failure = error instanceof Error ? error.message : String(error);
		this.api.log.warn("GitHub channel unavailable", { channel: this.id, error: this.failure });
	}
	private async save(): Promise<void> {
		await mkdir(this.api.paths.data, { recursive: true });
		await writeFile(`${this.file}.tmp`, JSON.stringify(this.cursor), { mode: 0o600 });
		await rename(`${this.file}.tmp`, this.file);
	}
	private async pollLoop(io: ChannelIO): Promise<void> {
		while (!this.controller.signal.aborted) {
			try {
				const signal = this.controller.signal;
				try {
					await recoverUpdates(this.api, this.id, this.config.repository, io, signal);
					if (this.releases) await this.releases.poll(this.client, io, signal);
					this.releaseFailure = undefined;
				} catch (error) {
					if (signal.aborted) throw error;
					this.releaseFailure = String(error);
					this.api.log.warn("GitHub release/update source unavailable", {
						instance: this.id,
						error: this.releaseFailure,
					});
				}
				this.self = login(await this.client.get("user", signal));
				if (!this.self) throw new Error("Authenticated GitHub login unavailable; run gh auth login --web");
				let latest = Date.parse(this.cursor.since);
				const since = encodeURIComponent(this.cursor.since);
				for await (const page of this.client.pages(
					`issues?state=all&sort=updated&direction=asc&since=${since}`,
					signal,
				)) {
					for (const issue of page) {
						const updated = Date.parse(String(issue.updated_at));
						if (!Number.isFinite(updated)) throw new Error("GitHub issue omitted updated_at");
						latest = Math.max(latest, updated);
						if (!this.admitted(issue)) continue;
						const id = nativeId(issue.id),
							number = Number(issue.number);
						if (!Number.isSafeInteger(number) || number <= 0) throw new Error("GitHub issue omitted number");
						const cursor = (this.cursor.issues[id] ??= { emitted: false, comment: "0" });
						if (!cursor.emitted && this.authorized(issue.user)) {
							await this.emit(io, issue, issue, `issue:${id}`, number);
							cursor.emitted = true;
							await this.save();
						}
						// Native comment ids advance only after durable input acceptance (or explicit filtering).
						// Fetch all pages in creation order; comment edits do not become duplicate tasks.
						for await (const comments of this.client.pages(`issues/${number}/comments`, signal)) {
							for (const comment of comments) {
								const commentId = nativeId(comment.id);
								if (BigInt(commentId) <= BigInt(cursor.comment)) continue;
								if (
									this.authorized(comment.user) &&
									!(login(comment.user) === this.self && String(comment.body ?? "").includes(marker))
								) {
									await this.emit(io, issue, comment, `comment:${commentId}`, number);
								}
								cursor.comment = commentId;
								await this.save();
							}
						}
					}
				}
				// Use GitHub object time, never a possibly fast local clock. Keep the timestamp boundary inclusive.
				this.cursor.since = new Date(Math.max(Date.parse(this.cursor.since), latest - 1000)).toISOString();
				await this.save();
				this.state = "ready";
				this.failure = undefined;
			} catch (error) {
				if (!this.controller.signal.aborted) this.unavailable(error);
			}
			if (this.controller.signal.aborted) break;
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, (this.config.pollSeconds ?? 60) * 1000);
				this.wake = () => {
					clearTimeout(timer);
					resolve();
				};
			});
			this.wake = undefined;
		}
	}
	private async emit(
		io: ChannelIO,
		issue: ObjectValue,
		source: ObjectValue,
		msgId: string,
		number: number,
	): Promise<void> {
		const author = login(source.user);
		await io.emit({
			type: "message.in",
			from: `acct:${this.id}:${author}`,
			conv: this.conv(number),
			data: {
				kind: "issue",
				msgId,
				name: author,
				text: JSON.stringify({
					repository: this.config.repository,
					issue: number,
					issueId: nativeId(issue.id),
					title: issue.title,
					issueUrl: issue.html_url,
					sourceUrl: source.html_url,
					author,
					body: source.body ?? "",
					issueBody: issue.body ?? "",
					source: msgId.startsWith("issue:") ? "issue" : "comment",
					externalContent: true,
				}),
			},
		});
	}
	async stop(): Promise<void> {
		this.controller.abort();
		this.wake?.();
		await this.loop;
		this.loop = undefined;
		this.state = "stopped";
	}
	async send(
		target: string,
		message: { text: string; attachments?: unknown[] },
		signal: AbortSignal = new AbortController().signal,
	) {
		try {
			const prefix = `conv:${this.id}:${this.config.repository}:issue:`;
			if (!target.startsWith(prefix) || !/^[1-9][0-9]*$/.test(target.slice(prefix.length)))
				throw new Error("GitHub output requires this instance's configured issue conversation");
			if (message.attachments?.length) throw new Error("GitHub issue comments do not support Yonder attachment upload");
			const number = target.slice(prefix.length);
			const issue = object(await this.client.get(this.client.path(`issues/${number}`), signal));
			if (!this.admitted(issue)) throw new Error("Issue is a PR or lacks the configured task labels");
			const result = await this.client.write(
				this.client.path(`issues/${number}/comments`),
				{ body: `${message.text}\n\n${marker}` },
				signal,
			);
			return { ok: true, id: nativeId(result.id) };
		} catch (error) {
			return { ok: false, error: String(error) };
		}
	}
}
