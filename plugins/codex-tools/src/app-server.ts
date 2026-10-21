import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid app-server object response");
	return value as RecordValue;
}
export class DeadlineError extends Error {}
export function executable(name: string): string {
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {}
	}
	throw new Error(`Program missing from PATH: ${name}`);
}

export class AppServer {
	readonly cwd: string;
	private child;
	private lines;
	private sequence = 0;
	private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	private listeners = new Set<(method: string, params: RecordValue) => void>();
	private failure: Error | undefined;
	private closing: Promise<void> | undefined;
	private exited: Promise<void>;
	private constructor(cwd: string) {
		this.cwd = cwd;
		const codex = executable("codex");
		this.child = spawn(codex, ["app-server"], { cwd, stdio: ["pipe", "pipe", "ignore"] });
		this.exited = new Promise((resolve) => {
			this.child.once("exit", (code, signal) => {
				this.fail(new Error(`app-server exited (${code ?? signal})`));
				resolve();
			});
			this.child.once("error", (error) => {
				this.fail(error);
				resolve();
			});
		});
		this.child.stdin.on("error", (error) => this.fail(error));
		this.lines = createInterface({ input: this.child.stdout });
		this.lines.on("line", (line) => {
			try {
				const message = record(JSON.parse(line));
				if (typeof message.method === "string") {
					if (message.id !== undefined) {
						this.send({
							id: message.id,
							error: { code: -32601, message: "Yonder does not grant interactive approvals or elicitation" },
						});
					} else {
						const params = record(message.params ?? {});
						for (const listener of this.listeners) listener(message.method, params);
					}
				} else if (typeof message.id === "number") {
					const pending = this.pending.get(message.id);
					if (message.error) pending?.reject(new Error(`app-server RPC: ${String(record(message.error).message)}`));
					else pending?.resolve(message.result);
				}
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		this.lines.on("close", () => this.fail(new Error("app-server stdout closed")));
	}
	static async open(signal: AbortSignal): Promise<AppServer> {
		signal.throwIfAborted();
		const cwd = await mkdtemp(join(tmpdir(), "yonder-codex-"));
		let client: AppServer | undefined;
		try {
			client = new AppServer(cwd);
			await client.request(
				"initialize",
				{
					clientInfo: { name: "yonder-harness", title: "Yonder Harness", version: "0.1.4" },
					capabilities: { experimentalApi: true },
				},
				signal,
			);
			client.send({ method: "initialized" });
			return client;
		} catch (error) {
			if (client) await client.close();
			else await rm(cwd, { recursive: true, force: true });
			throw error;
		}
	}
	private fail(error: Error): void {
		if (this.failure) return;
		this.failure = error;
		for (const pending of this.pending.values()) pending.reject(this.failure);
		for (const listener of this.listeners) {
			try {
				listener("connection/error", { message: error.message });
			} catch {}
		}
		this.listeners.clear();
	}
	private send(message: object): void {
		if (this.failure) throw this.failure;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}
	onNotification(listener: (method: string, params: RecordValue) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	async request(method: string, params: unknown, signal: AbortSignal, timeoutMs = 30_000): Promise<unknown> {
		signal.throwIfAborted();
		const id = ++this.sequence;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort = () => {};
		try {
			return await new Promise((resolve, reject) => {
				this.pending.set(id, { resolve, reject });
				abort = () => reject(signal.reason ?? new Error("Aborted"));
				signal.addEventListener("abort", abort, { once: true });
				timer = setTimeout(() => reject(new DeadlineError(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
				if (signal.aborted) abort();
				else this.send({ id, method, params });
			});
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			this.pending.delete(id);
		}
	}
	async statuses(threadId: string, signal: AbortSignal): Promise<RecordValue[]> {
		const results: RecordValue[] = [];
		const seen = new Set<string>();
		let cursor: string | undefined;
		do {
			const page = record(
				await this.request("mcpServerStatus/list", { threadId, detail: "full", ...(cursor ? { cursor } : {}) }, signal),
			);
			if (!Array.isArray(page.data)) throw new Error("Missing MCP status data");
			results.push(...page.data.map(record));
			cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
			if (cursor && seen.has(cursor)) throw new Error("Repeated MCP status cursor");
			if (cursor) seen.add(cursor);
		} while (cursor);
		return results;
	}
	close(): Promise<void> {
		this.closing ??= this.finish();
		return this.closing;
	}
	private async finish(): Promise<void> {
		this.fail(new Error("app-server connection released"));
		this.child.stdin.end();
		this.child.kill("SIGTERM");
		const timer = setTimeout(() => this.child.kill("SIGKILL"), 2_000);
		try {
			await this.exited;
		} finally {
			clearTimeout(timer);
			this.lines.close();
			await rm(this.cwd, { recursive: true, force: true });
		}
	}
}
