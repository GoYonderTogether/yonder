import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { type ConversationId, type Harness, LiveDoc } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { CredentialSlotStore } from "./credential-slots.js";
import { openDatabase } from "./db.js";
import { RunDoc } from "./docs.js";
import { Runtime } from "./index.js";
import type { RuntimeSessionConfig } from "./types.js";

it("a revoked recovered run faults locally while startup and another conversation remain usable", async () => {
	const home = mkdtempSync(join(realpathSync(tmpdir()), "yonder-slot-recover-"));
	const path = join(home, "state.db");
	const slots = new CredentialSlotStore(join(home, "auth.json"));
	await slots.commitLogin(await slots.beginLogin("openai", "a"), { type: "api_key", key: "fixture-no-network" });
	const config: RuntimeSessionConfig = {
		agent: null,
		profile: "test",
		cwd: home,
		resolved: resolveProfile({ credentialSlots: { openai: "a" } }),
		credentialGenerations: await slots.capture({ openai: "a" }),
	};
	const reports: unknown[] = [];
	// Open only real native SQLite/document/task machinery; no model is invoked.
	const options = {
		home,
		config: { schema: 1 as const, credentials: "auth.json" },
		resolveSession: async () => structuredClone(config),
		onReport: (error: unknown) => reports.push(error),
	};
	let runtime: Runtime | undefined;
	try {
		runtime = await Runtime.open({ ...options, db: await openDatabase(path) });
		const session = await runtime.create({ agent: null, profile: "test", cwd: home });
		let native = (runtime as unknown as { harness: Harness }).harness;
		const conversation = await native.conversation(Number(session) as ConversationId, C);
		if (!conversation) throw new Error("Missing fixture conversation");
		const submission = await conversation.submit({ type: "input", content: "persist without scheduling" }, C);
		const live = await native.snapshot(LiveDoc, conversation.id, C);
		expect(live?.run).toBeDefined();
		await native.commit(async (tx) => {
			Object.assign(await tx.doc(RunDoc, conversation.id, String(submission.id), null), {
				config: JSON.stringify(config),
				started: Date.now(),
			});
		}, C);
		await runtime.close();
		runtime = undefined;
		await slots.remove("openai", "a");
		runtime = await Runtime.open({ ...options, db: await openDatabase(path) });
		await expect(runtime.recover()).resolves.toBeUndefined();
		runtime.resume();
		native = (runtime as unknown as { harness: Harness }).harness;
		const recovered = await native.submission(submission.id, C);
		if (!recovered) throw new Error("Missing fixture submission");
		expect(await recovered.wait(C)).toMatchObject({ status: "unanswered", reason: "faulted" });
		const other = await runtime.create({ agent: null, profile: "test", cwd: home });
		expect((await runtime.submit(other, { text: "unrelated native write", wake: "write" })).status).toBe("done");
		expect(reports.length).toBeGreaterThan(0);
	} finally {
		await runtime?.close();
		rmSync(home, { recursive: true, force: true });
	}
});
