import type { ExecutionOwner } from "@yonder/sdk";

export class ClipError extends Error {}
export const fail = (code: string): never => {
	throw new ClipError(code);
};
export type Grant = {
	agent: string | null;
	profile: string;
	sealed: boolean;
	readRoots: string[];
	writeRoots: string[];
	destinations: string[];
	messageTargets: string[];
};
export type Consumer =
	| { kind: "child"; file: string; args: string[]; cwd: string; variable: string }
	| { kind: "http"; url: string; method: "POST" | "PUT"; header?: string };
export type Config = { maxBytes: number; ttlSeconds: number; grants: Grant[]; consumers: Record<string, Consumer> };
const object = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid_config");
	return value as Record<string, unknown>;
};
const strings = (value: unknown): string[] => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || !x || x.includes("\0")))
		return fail("invalid_config");
	return value;
};
export function bounded(value: unknown, fallback: number, max: number): number {
	const n = value ?? fallback;
	if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > max) return fail("invalid_limit");
	return n;
}
export function config(input: unknown): Config {
	const raw = object(input ?? {});
	const grants = raw.grants ?? [];
	if (!Array.isArray(grants)) return fail("invalid_config");
	const result: Config = {
		maxBytes: bounded(raw.maxBytes, 262144, 1048576),
		ttlSeconds: bounded(raw.ttlSeconds, 3600, 86400),
		grants: grants.map((value) => {
			const g = object(value);
			if (
				(g.agent !== null && typeof g.agent !== "string") ||
				typeof g.profile !== "string" ||
				!g.profile ||
				(g.sealed !== undefined && typeof g.sealed !== "boolean")
			)
				return fail("invalid_grant");
			const readRoots = strings(g.readRoots),
				writeRoots = strings(g.writeRoots);
			if ([...readRoots, ...writeRoots].some((x) => !x.startsWith("/"))) return fail("absolute_roots_required");
			return {
				agent: g.agent,
				profile: g.profile,
				sealed: g.sealed === true,
				readRoots,
				writeRoots,
				destinations: strings(g.destinations),
				messageTargets: strings(g.messageTargets),
			};
		}),
		consumers: {},
	};
	const seen = new Set<string>();
	for (const g of result.grants) {
		const key = JSON.stringify([g.agent, g.profile]);
		if (seen.has(key)) fail("duplicate_grant");
		seen.add(key);
	}
	for (const [id, value] of Object.entries(object(raw.consumers ?? {}))) {
		if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) fail("invalid_consumer_id");
		const c = object(value);
		if (c.kind === "child") {
			if (
				typeof c.file !== "string" ||
				!c.file.startsWith("/") ||
				typeof c.cwd !== "string" ||
				!c.cwd.startsWith("/") ||
				typeof c.variable !== "string" ||
				!/^[A-Z_][A-Z0-9_]*$/.test(c.variable)
			)
				fail("invalid_child");
			result.consumers[id] = {
				kind: "child",
				file: c.file as string,
				cwd: c.cwd as string,
				variable: c.variable as string,
				args: strings(c.args),
			};
		} else if (c.kind === "http") {
			const u = new URL(String(c.url));
			if (
				u.protocol !== "https:" ||
				u.username ||
				u.password ||
				u.hash ||
				u.search ||
				!["POST", "PUT"].includes(String(c.method)) ||
				(c.header !== undefined && (typeof c.header !== "string" || !/^[A-Za-z0-9-]+$/.test(c.header)))
			)
				fail("invalid_http");
			result.consumers[id] = {
				kind: "http",
				url: u.href,
				method: c.method as "POST" | "PUT",
				...(typeof c.header === "string" ? { header: c.header } : {}),
			};
		} else fail("invalid_consumer");
	}
	return result;
}
export const sameOwner = (a: ExecutionOwner, b: ExecutionOwner) =>
	a.agent === b.agent && a.profile === b.profile && a.session === b.session;
export function grantFor(c: Config, owner: ExecutionOwner): Grant {
	return c.grants.find((g) => g.agent === owner.agent && g.profile === owner.profile) ?? fail("profile_not_granted");
}
