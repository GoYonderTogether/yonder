import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { type Static, Type } from "typebox";
import { type Github, login, nativeId, type ObjectValue, object } from "./client.js";

export const ReleasesConfig = Type.Object(
	{
		approvedAuthors: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
		policy: Type.Optional(Type.Union([Type.Literal("notify"), Type.Literal("apply")])),
		notifyUpdates: Type.Optional(Type.Boolean()),
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
export type AvailableRelease = Pick<
	ReturnType<typeof releaseData>,
	"repository" | "releaseId" | "tag" | "version" | "url" | "author"
>;
/** Semver order. The host may run a test build (`X.Y.Z-beta.N`), which sorts before the same `X.Y.Z`. */
export function compareVersions(a: string, b: string): number {
	const pattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
	const left = pattern.exec(a),
		right = pattern.exec(b);
	if (!left || !right) throw new Error("Expected X.Y.Z or X.Y.Z-prerelease versions");
	for (const i of [1, 2, 3] as const) {
		const delta = BigInt(left[i] as string) - BigInt(right[i] as string);
		if (delta !== 0n) return delta > 0n ? 1 : -1;
	}
	const l = left[4]?.split("."),
		r = right[4]?.split(".");
	if (!l || !r) return l ? -1 : r ? 1 : 0;
	for (let i = 0; i < Math.max(l.length, r.length); i++) {
		const x = l[i],
			y = r[i];
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const numeric = /^[0-9]+$/;
		if (numeric.test(x) && numeric.test(y)) {
			const delta = BigInt(x) - BigInt(y);
			if (delta !== 0n) return delta > 0n ? 1 : -1;
		} else if (numeric.test(x) !== numeric.test(y)) return numeric.test(x) ? -1 : 1;
		else if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}
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
	latest: AvailableRelease | undefined;
	private seen = new Set<string>();
	private loaded = false;
	private baseline = false;
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
				this.baseline = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			this.loaded = true;
		}
		const releases = await client.list("releases", signal);
		let latest: AvailableRelease | undefined;
		for (const release of releases) {
			if (!approvedRelease(release, this.config)) continue;
			try {
				const { repository, releaseId, tag, version, url, author } = releaseData(this.repo, release);
				if (!latest || compareVersions(version, latest.version) > 0)
					latest = { repository, releaseId, tag, version, url, author };
			} catch {
				// Ineligible tags/URLs cannot become an upgrade suggestion.
			}
		}
		this.latest = latest;
		if (this.baseline) await this.save(this.seen);
		if (!this.baseline) {
			const ids = new Set(releases.map((release) => nativeId(release.id)));
			await this.save(ids);
			this.seen = ids;
			this.baseline = true;
			return;
		}
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
			const next = new Set(this.seen).add(id);
			await this.save(next);
			this.seen = next;
		}
	}
	private async save(ids: Set<string>): Promise<void> {
		await mkdir(this.api.paths.data, { recursive: true });
		await writeFile(`${this.file}.tmp`, JSON.stringify({ repository: this.repo, ids: [...ids], latest: this.latest }), {
			mode: 0o600,
		});
		await rename(`${this.file}.tmp`, this.file);
	}
}
