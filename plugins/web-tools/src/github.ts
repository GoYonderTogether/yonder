import type { ToolContext } from "@yonder/sdk";
import { httpGet } from "./shared.js";

/** github.com URLs resolve to raw file content or the GitHub API instead of the HTML page. */
const HOSTS = new Set(["github.com", "www.github.com"]);
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const MAX_ENTRIES = 200;

export type GithubTarget =
	| { kind: "file"; owner: string; repo: string; ref: string; path: string }
	| { kind: "repo"; owner: string; repo: string }
	| { kind: "dir"; owner: string; repo: string; ref: string; path: string };

export type GithubDocument =
	| {
			kind: "document";
			url: string;
			mime: string;
			source: "github";
			doc: "file" | "repo" | "dir";
			title: string;
			content: string;
			truncated: boolean;
			path?: string;
	  }
	| { kind: "binary"; url: string; mime: string };

function segments(url: URL): string[] {
	return url.pathname
		.split("/")
		.filter(Boolean)
		.map((segment) => decodeURIComponent(segment));
}

export function githubTarget(url: URL): GithubTarget | undefined {
	if (!HOSTS.has(url.hostname.toLowerCase())) return undefined;
	const [owner, repo, mode, ref, ...rest] = segments(url);
	if (!owner || !repo) return undefined;
	const path = rest.join("/");
	if (!mode) return { kind: "repo", owner, repo };
	if (!ref) return { kind: "repo", owner, repo };
	if (mode === "blob" || mode === "raw") return { kind: "file", owner, repo, ref, path };
	if (mode === "tree") return { kind: "dir", owner, repo, ref, path };
	return undefined;
}

function rawUrl(target: { owner: string; repo: string; ref: string; path: string }): string {
	return `${RAW}/${target.owner}/${target.repo}/${target.ref}/${target.path}`;
}

function apiUrl(path: string): string {
	return `${API}${path}`;
}

async function get(target: string, ctx: ToolContext, accept: string) {
	try {
		return await httpGet(new URL(target), ctx, { accept, extension: "json" });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/HTTP (?:403|429) /.test(message))
			throw new Error(`GITHUB_RATE_LIMIT: ${message}; anonymous GitHub API requests are rate limited`);
		throw error;
	}
}

function text(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString("utf8");
}

function json(bytes: Uint8Array, url: string): Record<string, unknown> | unknown[] {
	try {
		return JSON.parse(text(bytes)) as Record<string, unknown> | unknown[];
	} catch {
		throw new Error(`GITHUB_INVALID_JSON: ${url}`);
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function field(source: Record<string, unknown>, name: string): string | undefined {
	const value = source[name];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function fileDocument(
	target: Extract<GithubTarget, { kind: "file" }>,
	ctx: ToolContext,
): Promise<GithubDocument> {
	const url = rawUrl(target);
	const response = await get(url, ctx, "*/*");
	if (response.kind === "binary") return { kind: "binary", url, mime: response.mime };
	return {
		kind: "document",
		url,
		mime: response.mime,
		source: "github",
		doc: "file",
		title: `${target.owner}/${target.repo}/${target.path}`,
		content: text(response.bytes),
		truncated: response.truncated,
		...(response.path ? { path: response.path } : {}),
	};
}

async function repoDocument(
	target: Extract<GithubTarget, { kind: "repo" }>,
	ctx: ToolContext,
): Promise<GithubDocument> {
	const slug = `${target.owner}/${target.repo}`;
	const response = await get(apiUrl(`/repos/${slug}`), ctx, "application/vnd.github+json");
	if (response.kind === "binary") return { kind: "binary", url: response.url.href, mime: response.mime };
	const repo = record(json(response.bytes, response.url.href));
	const lines = [`# ${slug}`];
	const description = field(repo, "description");
	if (description) lines.push("", description);
	const details = [
		["default branch", field(repo, "default_branch")],
		["language", field(repo, "language")],
		["stars", repo.stargazers_count === undefined ? undefined : String(repo.stargazers_count)],
		["topics", Array.isArray(repo.topics) ? repo.topics.join(", ") || undefined : undefined],
		["homepage", field(repo, "homepage")],
		["license", field(record(repo.license), "spdx_id")],
	];
	const present = details.filter((entry): entry is [string, string] => Boolean(entry[1]));
	if (present.length) lines.push("", ...present.map(([name, value]) => `- ${name}: ${value}`));
	let readme = "";
	try {
		const page = await get(apiUrl(`/repos/${slug}/readme`), ctx, "application/vnd.github.raw");
		if (page.kind === "body") readme = text(page.bytes);
	} catch (error) {
		if (!/HTTP 404 /.test(error instanceof Error ? error.message : String(error))) throw error;
	}
	lines.push(
		"",
		readme ? `## README\n\n${readme}` : "_No README; use a raw file URL such as /blob/main/<path> for contents._",
	);
	return {
		kind: "document",
		url: `https://github.com/${slug}`,
		mime: "application/json",
		source: "github",
		doc: "repo",
		title: slug,
		content: lines.join("\n"),
		truncated: response.truncated,
	};
}

async function dirDocument(target: Extract<GithubTarget, { kind: "dir" }>, ctx: ToolContext): Promise<GithubDocument> {
	const slug = `${target.owner}/${target.repo}`;
	const query = `?ref=${encodeURIComponent(target.ref)}`;
	const response = await get(
		apiUrl(`/repos/${slug}/contents/${target.path}${query}`),
		ctx,
		"application/vnd.github+json",
	);
	if (response.kind === "binary") return { kind: "binary", url: response.url.href, mime: response.mime };
	const listing = json(response.bytes, response.url.href);
	const entries = Array.isArray(listing) ? listing : [listing];
	const shown = entries.slice(0, MAX_ENTRIES).map((entry) => {
		const item = record(entry);
		const name = field(item, "name") ?? "?";
		const type = field(item, "type") ?? "file";
		const size = typeof item.size === "number" ? ` (${item.size} bytes)` : "";
		return `- ${name} [${type}]${size}`;
	});
	const heading = `# ${slug}/${target.path || ""} @ ${target.ref}`.replace(/\/ @/, " @");
	const lines = [heading, "", ...shown];
	if (entries.length > shown.length) lines.push(`- ... ${entries.length - shown.length} more entries`);
	return {
		kind: "document",
		url: `https://github.com/${slug}/tree/${target.ref}/${target.path}`,
		mime: "application/json",
		source: "github",
		doc: "dir",
		title: `${slug}/${target.path}`,
		content: lines.join("\n"),
		truncated: response.truncated,
	};
}

export async function fetchGithubDocument(target: GithubTarget, ctx: ToolContext): Promise<GithubDocument> {
	if (target.kind === "file") return fileDocument(target, ctx);
	if (target.kind === "repo") return repoDocument(target, ctx);
	return dirDocument(target, ctx);
}
