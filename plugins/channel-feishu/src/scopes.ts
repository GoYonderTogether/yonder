import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeishuApi } from "./client.js";
import { object, string } from "./protocol.js";

/** Official per-tenant/app/version cap is 10 applies; stay below it. */
export const APPLY_LIMIT = 8;
const DEFAULT_SCOPES = ["im:message", "im:message:send_as_bot", "im:resource", "cardkit:card:write"];

/** Developer console permission page for an app. */
export const consoleUrl = (domain: string | undefined, appId: string): string =>
	`https://${domain === "lark" ? "open.larksuite.com" : "open.feishu.cn"}/app/${appId}/auth`;

/** Model-facing hint appended to 99991672/99991679 errors. */
export const scopeHint = (domain: string | undefined, appId: string): string =>
	`; call channel-feishu_scopes (action=status|apply) to inspect or apply scopes that are already added to the app, or have the owner add them and publish a version at ${consoleUrl(domain, appId)}`;

export interface ScopeStatus {
	granted: string[];
	pending: string[];
	/** Requested scopes not in the app configuration; only the console can add them. */
	notConfigured: string[];
	consoleUrl: string;
	applyAttempts: number;
}

export class FeishuScopes {
	constructor(
		private readonly client: FeishuApi,
		private readonly directory: string,
	) {}
	private async attempts(): Promise<number[]> {
		try {
			const rows: unknown = JSON.parse(await readFile(join(this.directory, "scope-apply.json"), "utf8"));
			return Array.isArray(rows) ? rows.filter((row): row is number => typeof row === "number") : [];
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}
	private async record(rows: number[]): Promise<void> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const temporary = join(this.directory, `scope-apply-${process.pid}.tmp`);
		await writeFile(temporary, JSON.stringify(rows), { mode: 0o600 });
		await rename(temporary, join(this.directory, "scope-apply.json"));
	}
	async status(requested?: string[], signal?: AbortSignal): Promise<ScopeStatus> {
		const result = await this.client.request("/application/v6/scopes", "GET", undefined, signal);
		const list = object(result.data).scopes;
		const granted = new Set<string>(),
			pending = new Set<string>();
		for (const item of Array.isArray(list) ? list : []) {
			const row = object(item),
				name = string(row.scope_name);
			if (!name) continue;
			// grant_status 1 = tenant granted; anything else is configured but not (yet) granted.
			(row.grant_status === 1 ? granted : pending).add(name);
		}
		for (const name of granted) pending.delete(name);
		const wanted = requested?.length ? requested : DEFAULT_SCOPES;
		const unique = [...new Set(wanted)];
		return {
			granted: unique.filter((name) => granted.has(name)),
			pending: unique.filter((name) => pending.has(name)),
			notConfigured: unique.filter((name) => !granted.has(name) && !pending.has(name)),
			consoleUrl: consoleUrl(this.client.config.domain, this.client.config.appId),
			applyAttempts: (await this.attempts()).length,
		};
	}
	/** Apply once for configured-but-ungranted scopes. The API takes no scope list: it applies every pending scope of the app. */
	async apply(requested?: string[], signal?: AbortSignal): Promise<ScopeStatus & { applied: boolean; note: string }> {
		const status = await this.status(requested, signal);
		if (!status.pending.length)
			return {
				...status,
				applied: false,
				note: status.notConfigured.length
					? `No requested scope is pending. ${status.notConfigured.join(",")} are not in the app configuration; the owner must add them and publish a version at ${status.consoleUrl}`
					: "All requested scopes are already granted",
			};
		const rows = await this.attempts();
		if (rows.length >= APPLY_LIMIT)
			return {
				...status,
				applied: false,
				note: `Apply limit reached (${rows.length} recorded; Feishu allows 10 per app version). Ask the tenant admin to approve at ${status.consoleUrl}`,
			};
		await this.record([...rows, Date.now()]);
		await this.client.request("/application/v6/scopes/apply", "POST", undefined, signal);
		return {
			...status,
			applyAttempts: rows.length + 1,
			applied: true,
			note: "Application sent to the tenant admin; the scopes are usable after approval",
		};
	}
}
