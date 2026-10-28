import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
