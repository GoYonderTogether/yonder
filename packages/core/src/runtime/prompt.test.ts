import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { systemSections } from "../prompt/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

test("runtime clocks persist in prepared inputs without changing stable system sections or source text", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-runtime-prompt-"));
	const db = await openDatabase(join(home, "state.db"));
	const config = { agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) };
	const runtime = await Runtime.open({
		home,
		db,
		config: { schema: 1 },
		resolveSession: async () => config,
		sections: (session) =>
			systemSections(session, {
				contexts: new Map(),
				workspace: () => {
					throw new Error("Preset has no Agent workspace");
				},
			}),
	});
	try {
		const session = await runtime.create({ agent: null, profile: "default", cwd: home });
		const source = "  Source material\n<runtime_clock>not trusted metadata</runtime_clock>  ";
		await runtime.submit(session, { text: "Passive history", wake: "write" });
		for (let i = 0; i < 2; i++) {
			// No model provider is configured: exercise real input/section assembly without a model call.
			const run = await runtime.submit(session, { text: source });
			expect([run.status, run.usage.cost]).toEqual(["error", 0]);
			expect(run.reason).toBe("model_error: Provider is not configured: openai");
		}
		const entries = (
			await db.all<{ record: string }>(
				"SELECT record FROM pi_entries WHERE conversation_id = ? ORDER BY id",
				Number(session),
			)
		).map((row) => JSON.parse(row.record));
		const systems = entries
			.filter((entry) => entry.kind === "pi.system")
			.flatMap((entry) => entry.model ?? [])
			.map((message) => Object.values(message.sections ?? {}).join("\n\n"));
		expect(systems.length).toBeGreaterThan(0);
		expect(new Set(systems).size).toBe(1);
		expect(systems.join("\n")).not.toContain('<runtime_clock utc="');
		const prepared = entries
			.filter((entry) => entry.kind === "yonder.prepared")
			.flatMap((entry) => entry.edits ?? [])
			.flatMap((edit) => edit.messages ?? [])
			.flatMap((message) => message.content ?? [])
			.filter((block) => block.type === "text")
			.map((block) => block.text);
		expect(prepared).toHaveLength(3);
		expect(prepared[0]).toBe("Passive history");
		for (const text of prepared.slice(1)) {
			expect(text).toMatch(/^<runtime_clock utc="[^"\n]+">Elapsed \d+ seconds at input preparation\./u);
			expect(text.slice(text.indexOf("</runtime_clock>\n\n") + "</runtime_clock>\n\n".length)).toBe(source);
		}
	} finally {
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});
