import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const children = new Set<ChildProcess>();
function child(dir: string, mode: "hold" | "attempt") {
	const source =
		`import { Ledger } from ${JSON.stringify(new URL("../dist/ledger.js", import.meta.url).href)};\nimport { createInterface } from "node:readline";\n` +
		`const l = new Ledger(${JSON.stringify(dir)});\n` +
		`try { await l.open(); console.log("READY"); if (${JSON.stringify(mode)} === "hold") { for await (const line of createInterface({input: process.stdin})) { if (line === "release") break; } await l.close(); console.log("CLOSED"); } else { await l.close(); console.log("ACQUIRED"); } } catch(e) { console.log("DENIED:" + (e.code ?? e.message)); process.exitCode=2; }`;
	const p = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["pipe", "pipe", "pipe"] });
	children.add(p);
	return p;
}
function nextLine(p: ChildProcess, timeoutMs = 5000): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => finish(new Error("child output timeout")), timeoutMs);
		const finish = (error?: Error, value?: string) => {
			clearTimeout(timer);
			p.stdout?.off("data", onData);
			p.off("exit", onExit);
			if (error) reject(error);
			else if (value !== undefined) resolve(value);
			else reject(new Error("missing child output"));
		};
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString();
			const i = buffer.indexOf("\n");
			if (i >= 0) finish(undefined, buffer.slice(0, i).trim());
		};
		const onExit = () => finish(new Error("child exited before expected line"));
		p.stdout?.on("data", onData);
		p.on("exit", onExit);
	});
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
	it("excludes a contender until the owning process closes, then admits a fresh process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "progress-observer-lease-"));
		try {
			const a = child(dir, "hold");
			expect(await nextLine(a)).toBe("READY");
			const b = child(dir, "attempt");
			expect((await nextLine(b)).startsWith("DENIED:")).toBe(true);
			await stop(b);
			children.delete(b);
			a.stdin?.write("release\n");
			expect(await nextLine(a)).toBe("CLOSED");
			await stop(a);
			children.delete(a);
			const c = child(dir, "attempt");
			expect(await nextLine(c)).toBe("READY");
			expect(await nextLine(c)).toBe("ACQUIRED");
			await stop(c);
			children.delete(c);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}, 15000);
});
