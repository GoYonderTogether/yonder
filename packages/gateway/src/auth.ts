import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Principal } from "@yonder/core";

export const COOKIE = "yonder_session";
export const COOKIE_TTL_MS = 24 * 3600_000;
const TICKET_TTL_MS = 10 * 60_000;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => `sha256:${sha256(token)}`;

export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export const principals = {
	local: { id: "gateway:local", transport: "gateway", kind: "local", scopes: ["read", "write", "admin", "owner"] },
	remote: { id: "gateway:remote", transport: "gateway", kind: "remote", scopes: ["read", "write"] },
} as const satisfies Record<string, Principal>;
/** Remote logins only get `owner` when the node opts in (gateway.remoteOwner). */
export const principalOf = (login: Login, remoteOwner: boolean): Principal =>
	login === "remote" && remoteOwner
		? { ...principals.remote, scopes: [...principals.remote.scopes, "owner"] }
		: principals[login];
export type Login = keyof typeof principals;

/** One-time login tickets: the startup token plus any minted later. Only hashes are kept. */
export class Tickets {
	private readonly live = new Map<string, number>();
	issue(ttlMs = TICKET_TTL_MS): { token: string; expiresAt: number } {
		const token = newToken();
		const expiresAt = Number.isFinite(ttlMs) ? Date.now() + ttlMs : Number.POSITIVE_INFINITY;
		this.live.set(sha256(token), expiresAt);
		return { token, expiresAt };
	}
	consume(token: string): boolean {
		const key = sha256(token);
		const expiresAt = this.live.get(key);
		this.live.delete(key);
		return expiresAt !== undefined && expiresAt > Date.now();
	}
}

/** Signed session cookie: `<payload>.<hmac>`. Remote cookies embed the access-token hash so rotating it logs everyone out. */
export class Sessions {
	constructor(private readonly key: Buffer) {}
	static async open(home: string): Promise<Sessions> {
		const file = join(home, ".yonder", "gateway-key");
		try {
			return new Sessions(Buffer.from((await readFile(file, "utf8")).trim(), "base64url"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const key = randomBytes(32);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, key.toString("base64url"), { mode: 0o600 });
		await chmod(file, 0o600);
		return new Sessions(key);
	}
	private mac(payload: string) {
		return createHmac("sha256", this.key).update(payload).digest("base64url");
	}
	sign(login: Login, accessHash?: string, ttlMs = COOKIE_TTL_MS): string {
		const payload = Buffer.from(
			JSON.stringify({
				exp: Date.now() + ttlMs,
				k: login,
				g: accessHash ? sha256(accessHash).slice(0, 16) : "",
			}),
		).toString("base64url");
		return `${payload}.${this.mac(payload)}`;
	}
	verify(value: string | undefined, accessHash: string | undefined): Login | undefined {
		return this.inspect(value, accessHash)?.login;
	}
	/** Like verify, but also returns the cookie's expiry (ms epoch) so open sockets can be re-checked. */
	inspect(value: string | undefined, accessHash: string | undefined): { login: Login; exp: number } | undefined {
		if (!value) return undefined;
		const [payload, mac, extra] = value.split(".");
		if (!payload || !mac || extra !== undefined || !safeEqual(mac, this.mac(payload))) return undefined;
		let body: { exp: number; k: string; g: string };
		try {
			body = JSON.parse(Buffer.from(payload, "base64url").toString());
		} catch {
			// A validly signed but unparsable payload cannot come from sign(); treat as no session.
			return undefined;
		}
		if (typeof body.exp !== "number" || body.exp < Date.now()) return undefined;
		if (body.k === "local") return { login: "local", exp: body.exp };
		if (body.k === "remote" && accessHash && safeEqual(String(body.g), sha256(accessHash).slice(0, 16)))
			return { login: "remote", exp: body.exp };
		return undefined;
	}
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
	for (const part of (header ?? "").split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return undefined;
}

/** Failed-login limiter: `limit` failures per `windowMs` per key; at most `maxKeys` keys are remembered. */
export class Limiter {
	private readonly hits = new Map<string, { count: number; since: number }>();
	constructor(
		private readonly limit = 10,
		private readonly windowMs = 60_000,
		private readonly maxKeys = 1024,
	) {}
	blocked(key: string): boolean {
		const hit = this.hits.get(key);
		if (hit && Date.now() - hit.since > this.windowMs) this.hits.delete(key);
		return (this.hits.get(key)?.count ?? 0) >= this.limit;
	}
	fail(key: string) {
		const hit = this.hits.get(key);
		if (!hit || Date.now() - hit.since > this.windowMs) {
			this.hits.delete(key);
			if (this.hits.size >= this.maxKeys) this.makeRoom();
			this.hits.set(key, { count: 1, since: Date.now() });
		} else hit.count++;
	}
	/** Drop expired keys; if every key is live, drop the oldest (Map keeps insertion order). */
	private makeRoom() {
		const now = Date.now();
		for (const [key, hit] of this.hits) if (now - hit.since > this.windowMs) this.hits.delete(key);
		while (this.hits.size >= this.maxKeys) {
			const oldest = this.hits.keys().next().value;
			if (oldest === undefined) break;
			this.hits.delete(oldest);
		}
	}
}
