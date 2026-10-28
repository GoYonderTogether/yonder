import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { ConversationId, EntryId } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
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
		const parent = await runtime["harness"].conversation(Number(id) as ConversationId, C);
		const first = online[0];
		if (!parent || !first) throw new Error("Missing parent conversation or entry");
		const child = await parent.fork(first.id as EntryId, { ownership: { kind: "ownerless" } }, C);
		await runtime.submit(String(child.id), { text: "Forked transcript verification", wake: "write" });
		const childOnline = await runtime.transcript(String(child.id));
		const childEntry = childOnline[1];
		if (!childEntry) throw new Error("Missing child entry");
		await runtime.close();
		runtime = undefined;
		const db = await openDatabase(path, true);
		try {
			expect(await readTranscript(db, id)).toEqual(online);
			expect(await readTranscript(db, String(child.id))).toEqual(childOnline);
			expect(await readTranscript(db, String(child.id), { from: childEntry.id, limit: 1 })).toEqual(
				childOnline.slice(1, 2),
			);
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
