// Derived from pi coding-agent 1.3.0, MIT; see THIRD_PARTY_NOTICES.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import lockfile from "proper-lockfile";

const MAX_EPERM_RETRIES = 5;

export const credentialPath = (home: string, path = ".yonder/auth.json") =>
	path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(home, path);

function getRetryableLockErrorCode(error: unknown): "ELOCKED" | "EPERM" | undefined {
	const code = error instanceof Error && "code" in error ? error.code : undefined;
	if (code === "ELOCKED") return code;
	if (code === "EPERM" && process.platform === "win32") return code;
	return undefined;
}

type LockResult<T> = {
	result: T;
	next?: string;
};

// The mode applies only on creation so administrator-managed modes and ACLs remain intact.
const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

export interface AuthStorageBackend {
	withLockAsync<T>(
		fn: (current: string | undefined) => Promise<LockResult<T>>,
		options?: AuthOperationOptions,
	): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	private authPath: string;

	constructor(authPath: string) {
		this.authPath = resolve(authPath);
	}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
		}
	}

	private async acquireLockAsync(
		signal: AbortSignal | undefined,
		onCompromised: (error: Error) => void,
	): Promise<() => Promise<void>> {
		const staleMs = 30_000;
		const maxDelayMs = 2_000;
		const deadline = Date.now() + staleMs;
		let retry = 0;
		let epermRetries = 0;
		while (true) {
			signal?.throwIfAborted();
			let release: (() => Promise<void>) | undefined;
			try {
				release = await lockfile.lock(this.authPath, {
					realpath: false,
					retries: 0,
					stale: staleMs,
					onCompromised,
				});
			} catch (error) {
				signal?.throwIfAborted();
				const code = getRetryableLockErrorCode(error);
				const remainingMs = deadline - Date.now();
				if (!code || remainingMs <= 0) throw error;
				// The 30s deadline is for waiting on another holder; cap EPERM retries separately.
				if (code === "EPERM" && ++epermRetries > MAX_EPERM_RETRIES) throw error;
				const baseDelayMs = Math.min(10 * 2 ** retry, maxDelayMs / 2);
				retry++;
				const delayMs = Math.min(Math.round(baseDelayMs * (1 + Math.random())), remainingMs);
				if (signal) await sleep(delayMs, undefined, { signal });
				else await sleep(delayMs);
				continue;
			}
			if (signal?.aborted) {
				await release();
				signal.throwIfAborted();
			}
			return release;
		}
	}

	async withLockAsync<T>(
		fn: (current: string | undefined) => Promise<LockResult<T>>,
		options?: AuthOperationOptions,
	): Promise<T> {
		options?.signal?.throwIfAborted();
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await this.acquireLockAsync(options?.signal, (error) => {
				lockCompromised = true;
				lockCompromisedError = error;
			});

			throwIfCompromised();
			options?.signal?.throwIfAborted();
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await fn(current);
			throwIfCompromised();
			options?.signal?.throwIfAborted();
			if (next !== undefined) {
				writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
			}
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}
}

function parse(content: string | undefined): Record<string, Credential> {
	let data: unknown;
	try {
		data = content ? JSON.parse(content.replace(/^\uFEFF/, "")) : {};
	} catch {
		throw new Error("Invalid auth.json: cannot parse JSON");
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid auth.json: expected object");
	for (const [name, credential] of Object.entries(data)) {
		if (!credential || typeof credential !== "object" || Array.isArray(credential))
			throw new Error(`Invalid credential: ${name}`);
		const value = credential as Record<string, unknown>;
		if (value.type === "api_key" && (value.key === undefined || typeof value.key === "string")) continue;
		if (
			value.type === "oauth" &&
			typeof value.access === "string" &&
			typeof value.refresh === "string" &&
			typeof value.expires === "number" &&
			Number.isFinite(value.expires)
		)
			continue;
		throw new Error(`Invalid credential: ${name}`);
	}
	return data as Record<string, Credential>;
}
export class FileCredentials implements CredentialStore {
	private backend: FileAuthStorageBackend;
	constructor(path: string) {
		this.backend = new FileAuthStorageBackend(path);
	}
	async read(name: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		return this.backend.withLockAsync(async (content) => {
			const data = parse(content);
			return { result: Object.hasOwn(data, name) ? data[name] : undefined };
		}, options);
	}
	get(name: string): Promise<Credential | undefined> {
		return this.read(name);
	}
	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		return this.backend.withLockAsync(
			async (content) => ({
				result: Object.entries(parse(content)).map(([providerId, value]) => ({ providerId, type: value.type })),
			}),
			options,
		);
	}
	async modify(
		name: string,
		fn: (value: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return this.backend.withLockAsync(async (content) => {
			const data = parse(content),
				next = await fn(Object.hasOwn(data, name) ? data[name] : undefined);
			if (next === undefined) return { result: Object.hasOwn(data, name) ? data[name] : undefined };
			return { result: next, next: JSON.stringify({ ...data, [name]: next }, null, 2) };
		}, options);
	}
	async delete(name: string, options?: AuthOperationOptions): Promise<void> {
		return this.backend.withLockAsync(async (content) => {
			const data = parse(content);
			delete data[name];
			return { result: undefined, next: JSON.stringify(data, null, 2) };
		}, options);
	}
}
