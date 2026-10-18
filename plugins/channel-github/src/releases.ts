import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { Type, type Static } from "typebox";
import { Github, login, nativeId, object, type ObjectValue } from "./client.js";

export const ReleasesConfig = Type.Object(
	{
		approvedAuthors: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
		policy: Type.Optional(Type.Union([Type.Literal("notify"), Type.Literal("apply")])),
		notifyTarget: Type.Optional(Type.String({ pattern: "^(person|acct|conv):\\S+$" })),
		updater: Type.Optional(
			Type.Object(
				{
					install: Type.String({ pattern: "^/" }),
					home: Type.String({ pattern: "^/" }),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
export type ReleasesOptions = Static<typeof ReleasesConfig>;
export function releaseVersion(release: ObjectValue): string {
	const match = /^v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/.exec(String(release.tag_name));
	if (!match?.[1]) throw new Error("Release tag must be an installable vX.Y.Z version");
	return match[1];
}
export function approvedRelease(release: ObjectValue, config: ReleasesOptions): boolean {
	return (
		release.draft === false &&
		release.prerelease === false &&
		typeof release.published_at === "string" &&
		config.approvedAuthors.some((account) => account.toLowerCase() === login(release.author))
	);
}
export function releaseData(repo: string, release: ObjectValue) {
	const id = nativeId(release.id);
	const url = String(release.html_url);
	if (!url.startsWith(`https://github.com/${repo}/releases/`))
		throw new Error("Release source URL does not match configured repository");
	return {
		repository: repo,
		releaseId: id,
		tag: String(release.tag_name),
		version: releaseVersion(release),
		url,
		sourceUrl: url,
		name: release.name,
		body: release.body ?? "",
		author: login(release.author),
		publishedAt: release.published_at,
	};
}
export class Releases {
	private seen = new Set<string>();
	private loaded = false;
	private file: string;
	constructor(
		readonly instance: string,
		private repo: string,
		private config: ReleasesOptions,
		private api: PluginAPI,
	) {
		this.file = join(api.paths.data, `${instance}.releases.json`);
	}
	async poll(client: Github, io: ChannelIO, signal: AbortSignal): Promise<void> {
		if (!this.loaded) {
			try {
				const state = object(JSON.parse(await readFile(this.file, "utf8")));
				if (
					state.repository !== this.repo ||
					!Array.isArray(state.ids) ||
					!state.ids.every((value) => typeof value === "string" && /^[1-9][0-9]*$/.test(value))
				)
					throw new Error("Invalid release cursor/repository; preserve file and resolve configuration");
				this.seen = new Set(state.ids as string[]);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			this.loaded = true;
		}
		const releases = await client.list("releases", signal);
		releases.sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)));
		for (const release of releases) {
			const id = nativeId(release.id);
			if (this.seen.has(id) || !approvedRelease(release, this.config)) continue;
			let data: ReturnType<typeof releaseData>;
			try {
				data = releaseData(this.repo, release);
			} catch (error) {
				this.api.log.warn("Release is not an eligible installable project version", {
					instance: this.instance,
					releaseId: id,
					error: String(error),
				});
				continue;
			}
			await io.emit({
				type: "channel-github.release",
				from: "plugin:channel-github",
				conv: `conv:${this.instance}:${this.repo}:releases`,
				data: {
					...data,
					msgId: `release:${id}:published`,
					externalContent: true,
					updatePolicy: this.config.policy ?? "notify",
					notificationTarget: this.config.notifyTarget ?? null,
					notified: false,
				},
			});
			this.seen.add(id);
			await mkdir(this.api.paths.data, { recursive: true });
			await writeFile(`${this.file}.tmp`, JSON.stringify({ repository: this.repo, ids: [...this.seen] }), {
				mode: 0o600,
			});
			await rename(`${this.file}.tmp`, this.file);
		}
	}
}
