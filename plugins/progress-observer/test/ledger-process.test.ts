import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children = new Set<ChildProcess>();
const readers = new WeakMap<ChildProcess, ChildOutput>();

class ChildOutput {
	private buffer = "";
	private lines: string[] = [];
	private waiters: Array<(line: string) => void> = [];
	private stderr = "";
	private exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
	private closed = false;
	readonly close: Promise<void>;

	constructor(
		process: ChildProcess,
		private readonly role: string,
	) {
		this.close = new Promise((resolve) => process.once("close", () => resolve()));
		process.stdout?.setEncoding("utf8");
		process.stdout?.on("data", (chunk: string) => {
			this.buffer += chunk;
			const split = this.buffer.split("\n");
			this.buffer = split.pop() ?? "";
			for (const line of split) this.deliver(line.trim());
		});
		process.stderr?.setEncoding("utf8");
		process.stderr?.on("data", (chunk: string) => {
			this.stderr += chunk;
		});
		process.on("exit", (code, signal) => {
			this.exit = { code, signal };
		});
		process.on("close", () => {
			this.closed = true;
			if (this.buffer) this.deliver(this.buffer.trim());
			this.buffer = "";
		});
	}

	private deliver(line: string) {
		const waiter = this.waiters.shift();
		if (waiter) waiter(line);
		else this.lines.push(line);
	}

	nextLine(phase: string, timeoutMs = 5000): Promise<string> {
		const queued = this.lines.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		if (this.closed) return Promise.reject(this.failure(phase));
		return new Promise((resolve, reject) => {
			const onLine = (line: string) => {
				clearTimeout(timer);
				resolve(line);
			};
			const timer = setTimeout(() => {
				this.waiters = this.waiters.filter((waiter) => waiter !== onLine);
				reject(new Error(`${this.role} during ${phase}: output timeout; ${this.details()}`));
			}, timeoutMs);
			this.waiters.push(onLine);
		});
	}

	private details() {
		return `exitCode=${this.exit?.code ?? "null"} signal=${this.exit?.signal ?? "null"} stderr=${JSON.stringify(this.stderr)}`;
	}
	private failure(phase: string) {
		return new Error(`${this.role} during ${phase}: child closed before expected line; ${this.details()}`);
	}
}

function child(dir: string, mode: "hold" | "attempt") {
	const source =
		`import { Ledger } from ${JSON.stringify(new URL("../dist/ledger.js", import.meta.url).href)};\nimport { createInterface } from "node:readline";\n` +
		`const l = new Ledger(${JSON.stringify(dir)});\n` +
		`const wait = async (token) => { for await (const line of createInterface({input: process.stdin})) if (line === token) return; };\n` +
		`try { await l.open(); console.log("READY"); if (${JSON.stringify(mode)} === "hold") { await wait("release"); await l.close(); console.log("RELEASED"); } else { await wait("acquire"); await l.close(); console.log("ACQUIRED"); } } catch(e) { console.log("DENIED:" + (e.code ?? e.message)); await wait("ack"); }`;
	const p = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["pipe", "pipe", "pipe"] });
	children.add(p);
	readers.set(p, new ChildOutput(p, mode === "hold" ? "lease owner" : "contender/reacquirer"));
	return p;
}

function nextLine(p: ChildProcess, phase: string, timeoutMs = 5000): Promise<string> {
	const reader = readers.get(p);
	if (!reader) throw new Error(`no output reader registered for ${phase}`);
	return reader.nextLine(phase, timeoutMs);
}

async function stop(p: ChildProcess) {
	if (p.exitCode !== null || p.signalCode !== null) return;
	p.kill("SIGTERM");
	await Promise.race([
		new Promise<void>((r) => p.once("exit", () => r())),
		new Promise<void>((r) => setTimeout(r, 1500)),
	]);
	if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
}

afterEach(async () => {
	await Promise.all([...children].map(stop));
	children.clear();
});

describe("Ledger real process lease", () => {
	it("retains every line from one chunk when a child exits immediately", async () => {
		const p = spawn(process.execPath, ["-e", "process.stdout.write('READY\\nACQUIRED\\n')"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		children.add(p);
		const reader = new ChildOutput(p, "synthetic quick-exit child");
		readers.set(p, reader);
		expect(await nextLine(p, "read READY")).toBe("READY");
		expect(await nextLine(p, "read ACQUIRED")).toBe("ACQUIRED");
		await reader.close;
		children.delete(p);
	});

	it("excludes a contender until the owning process closes, then admits a fresh process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "progress-observer-lease-"));
		try {
			const a = child(dir, "hold");
			expect(await nextLine(a, "owner ready handshake")).toBe("READY");
			const b = child(dir, "attempt");
			expect((await nextLine(b, "contender denial")).startsWith("DENIED:")).toBe(true);
			b.stdin?.write("ack\n");
			await stop(b);
			children.delete(b);
			a.stdin?.write("release\n");
			expect(await nextLine(a, "owner released handshake")).toBe("RELEASED");
			await stop(a);
			children.delete(a);
			const c = child(dir, "attempt");
			expect(await nextLine(c, "reacquirer ready handshake")).toBe("READY");
			c.stdin?.write("acquire\n");
			expect(await nextLine(c, "reacquirer acquired handshake")).toBe("ACQUIRED");
			await stop(c);
			children.delete(c);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 15000);
});
