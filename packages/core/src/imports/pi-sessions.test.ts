import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPiSessionsDir, listPiSessions, parsePiSession, showPiSession } from "./pi-sessions.js";

// Runs against the real pi sessions on this machine; skipped where pi has never been used.
const dir = defaultPiSessionsDir();
const present = existsSync(dir);

describe.skipIf(!present)("pi session import (real files)", () => {
	it("parses every session file with paired tool calls and consistent usage", async () => {
		const { sessions } = await listPiSessions(dir, { limit: 1000 });
		expect(sessions.length).toBeGreaterThan(0);
		for (const session of sessions) {
			const parsed = parsePiSession(await readFile(join(dir, session.id), "utf8"));
			expect(parsed.items.length).toBeGreaterThan(0);
			const calls = new Set(parsed.items.flatMap((i) => (i.kind === "tool_call" ? [i.callId] : [])));
			for (const item of parsed.items) if (item.kind === "tool_result") expect(calls.has(item.callId)).toBe(true);
			const byModel = Object.values(parsed.usage.byModel);
			expect(byModel.reduce((n, m) => n + m.output, 0)).toBe(parsed.usage.totals.output);
			expect(byModel.reduce((n, m) => n + m.messages, 0)).toBe(parsed.usage.assistantMessages);
			if (parsed.todo) {
				expect(parsed.todo.total).toBe(parsed.todo.items.filter((i) => i.state !== "cancelled").length);
				expect(parsed.todo.done).toBeLessThanOrEqual(parsed.todo.total);
			}
		}
	});

	it("tolerates unknown entry types and broken lines", async () => {
		const { sessions } = await listPiSessions(dir, { limit: 1 });
		const text = await readFile(join(dir, sessions[0]!.id), "utf8");
		const parsed = parsePiSession(`${text.trimEnd()}\n{"type":"entry_from_a_future_pi","id":"x1"}\n{not json\n`);
		expect(parsed.items.at(-1)).toMatchObject({ kind: "unknown", type: "entry_from_a_future_pi" });
		expect(parsed.issues.length).toBeGreaterThanOrEqual(1);
	});

	it("pages items and refuses paths outside the sessions directory", async () => {
		const { sessions } = await listPiSessions(dir, { limit: 1 });
		const id = sessions[0]!.id;
		const page = await showPiSession(dir, id, { offset: 0, limit: 5 });
		expect(page.items.length).toBeLessThanOrEqual(5);
		expect(page.summary.id).toBe(id);
		await expect(showPiSession(dir, "../../../etc/passwd", {})).rejects.toThrow();
	});
});

describe("pi session import limits (temp files)", () => {
	const line = (n: number) =>
		`${JSON.stringify({ type: "message", id: `m${n}`, message: { role: "user", content: [{ type: "text", text: "x".repeat(900) }] } })}\n`;

	it("truncates files over the byte cap at a line boundary and says so", async () => {
		const root = await mkdtemp(join(tmpdir(), "yonder-imports-"));
		try {
			await writeFile(join(root, "small.jsonl"), line(0));
			await writeFile(join(root, "big.jsonl"), line(1).repeat(Math.ceil((33 * 1024 * 1024) / line(1).length)));
			const { sessions } = await listPiSessions(root);
			const big = sessions.find((row) => row.id === "big.jsonl");
			expect(big?.truncated).toBe(true);
			expect(big?.bytes).toBeGreaterThan(32 * 1024 * 1024);
			expect(sessions.find((row) => row.id === "small.jsonl")?.truncated).toBe(false);
			const page = await showPiSession(root, "big.jsonl", { limit: 1 });
			expect(page.summary.truncated).toBe(true);
			expect(page.issues).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}, 60_000);

	it("does not follow a symlink that points outside the sessions directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "yonder-imports-"));
		const outside = await mkdtemp(join(tmpdir(), "yonder-outside-"));
		try {
			await writeFile(join(outside, "secret.jsonl"), line(0));
			await mkdir(join(root, "d"));
			await symlink(join(outside, "secret.jsonl"), join(root, "d", "link.jsonl"));
			await expect(showPiSession(root, "d/link.jsonl", {})).rejects.toMatchObject({ code: "not_found" });
			expect((await listPiSessions(root)).sessions).toEqual([]);
		} finally {
			await rm(root, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});
});
