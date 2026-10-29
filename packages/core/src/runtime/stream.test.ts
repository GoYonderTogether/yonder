import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { OutputPart } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna tool run emits process output before its answer",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-stream-"));
		let runtime: Runtime | undefined;
		try {
			runtime = await Runtime.open({
				home,
				db: await openDatabase(`${home}/state.db`),
				config: { schema: 1, credentials: auth },
				resolveSession: async () => ({
					agent: null,
					profile: "check",
					cwd: home,
					resolved: resolveProfile({
						model: "openai/gpt-6-luna",
						capabilities: ["exec"],
						tools: { offer: ["bash"] },
						limits: { maxMinutes: 1 },
					}),
				}),
			});
			const id = await runtime.create({ agent: null, profile: "check", cwd: home });
			const parts: OutputPart[] = [];
			const run = await runtime.submit(id, {
				text: "Call bash exactly once with: printf yonder-stream-check. Then reply with the command output.",
				onOutput: (part) => parts.push(part),
			});
			expect(run.status, run.reason).toBe("done");
			expect(run.text).toContain("yonder-stream-check");
			expect(parts.some((part) => part.type === "tool" && part.phase === "start")).toBe(true);
			expect(parts.some((part) => part.type === "tool" && part.phase === "end")).toBe(true);
			expect(parts.some((part) => part.type === "text")).toBe(true);
		} finally {
			await runtime?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	90000,
);
