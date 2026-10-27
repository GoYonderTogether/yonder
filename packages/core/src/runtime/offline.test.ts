import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { Runtime, readTranscript } from "./index.js";

test("offline transcript matches the live conversation over an actual read-only SQLite connection", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-offline-"));
	const path = join(home, "state.db");
	let runtime: Runtime | undefined;
	try {
		runtime = await Runtime.open({
			home,
			db: await openDatabase(path),
			config: { schema: 1 },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
		});
		const id = await runtime.create({ agent: null, profile: "default", cwd: home });
		await runtime.submit(id, { text: "Offline transcript verification", wake: "write" });
		const online = await runtime.transcript(id);
		await runtime.close();
		runtime = undefined;
		const db = await openDatabase(path, true);
		try {
			expect(await readTranscript(db, id)).toEqual(online);
			expect(await readTranscript(db, id, { from: (online[0]?.id ?? 0) + 1 })).toEqual([]);
			await expect(db.run("CREATE TABLE forbidden_write (id INTEGER)")).rejects.toThrow();
		} finally {
			await db.close();
		}
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("empty task report is unknown without changing run status", async () => {
	const { taskReport } = await import("./results.js");
	for (const text of ["", "  ", " NO_REPLY\n"]) expect(taskReport(text)).toBe("STATUS: unknown (no report)");
	expect(taskReport("STATUS: partial\nRemaining: real acceptance")).toBe("STATUS: partial\nRemaining: real acceptance");
});
