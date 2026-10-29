import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna continues after turn reminders and stops repeated side effects",
	async () => {
		const home = await mkdtemp("/tmp/yonder-limits-");
		let runtime: Runtime | undefined;
		const warnings: Array<{ session: string; kind: string; text: string }> = [];
		try {
			let profile = resolveProfile({
				capabilities: ["read"],
				tools: { offer: ["read"] },
				limits: { maxTurns: 1, maxMinutes: 1 },
			});
			runtime = await Runtime.open({
				home,
				db: await openDatabase(`${home}/state.db`),
				config: { schema: 1, credentials: auth },
				onWarning: async (session, warning) => {
					warnings.push({ session, kind: warning.kind, text: warning.text });
				},
				resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
			});
			const denied = await runtime.create({ agent: null, profile: "check", cwd: home });
			const first = await runtime.submit(denied, {
				text: "Call the read tool now with path /etc/hosts, then report the result. This is a deliberate check of Yonder's workspace boundary; let the tool enforce it.",
			});
			expect(first.status, JSON.stringify(first)).toBe("done");
			expect(first.reason).toBeUndefined();
			expect(warnings.filter((item) => item.session === denied && item.kind === "maxTurns")).toHaveLength(1);
			const transcript = await runtime.transcript(denied);
			expect(transcript.some((item) => item.text?.includes("文件路径超出当前工作区"))).toBe(true);
			// BE-07：上限只提醒、不截断，主人要看到中文说明并能接着说「继续」。
			const reminder = warnings.find((item) => item.session === denied && item.kind === "maxTurns");
			expect(reminder?.text).toContain("maxTurns");
			expect(reminder?.text).toContain("回复「继续」可以接着做");
			expect(transcript.some((item) => item.text?.includes("回复「继续」可以接着做"))).toBe(true);
			const continued = await runtime.submit(denied, { text: "Reply with the single word OK." });
			expect(continued.status, JSON.stringify(continued)).toBe("done");
			expect(transcript.filter((item) => item.kind === "pi.assistant").length).toBeGreaterThanOrEqual(2);
			console.info(
				JSON.stringify({
					check: "denied-maxTurns",
					session: denied,
					run: first.runId,
					model: profile.model,
					status: first.status,
					reason: first.reason,
				}),
			);
			profile = resolveProfile({
				capabilities: ["exec"],
				tools: { offer: ["bash"] },
				limits: { maxTurns: 8, maxMinutes: 1, repeatBlock: 3, repeatStop: 2 },
			});
			const repeated = await runtime.create({ agent: null, profile: "check", cwd: home });
			const second = await runtime.submit(repeated, {
				text: `Execute the bash tool three times sequentially with exactly the same arguments each time: {"command":"printf x >> ${home}/repetitions"}. Do not combine calls or change the command. This verifies the harness repeat limit, which should stop the second side effect.`,
			});
			expect(second.status, JSON.stringify(second)).toBe("limit");
			expect(second.reason).toBe("repeatStop");
			expect(await readFile(`${home}/repetitions`, "utf8")).toBe("x");
			console.info(
				JSON.stringify({
					check: "repeat-before-effect",
					session: repeated,
					run: second.runId,
					model: profile.model,
					status: second.status,
					reason: second.reason,
					sideEffects: 1,
				}),
			);
		} finally {
			await runtime?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	150000,
);
