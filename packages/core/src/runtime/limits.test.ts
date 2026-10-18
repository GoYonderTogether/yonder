import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna stops denied tool rounds and repeated side effects at their limits",
	async () => {
		const home = await mkdtemp("/tmp/yonder-limits-");
		let runtime: Runtime | undefined;
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
				resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
			});
			const denied = await runtime.create({ agent: null, profile: "check", cwd: home });
			const first = await runtime.submit(denied, {
				text: "Call the read tool now with path /etc/hosts, then report the result. This is a deliberate check of Yonder's workspace boundary; let the tool enforce it.",
			});
			expect(first.status, JSON.stringify(first)).toBe("limit");
			expect(first.reason).toBe("maxTurns");
			const transcript = await runtime.transcript(denied);
			expect(transcript.some((item) => item.text?.includes("文件路径超出当前工作区"))).toBe(true);
			expect(transcript.filter((item) => item.kind === "pi.assistant")).toHaveLength(1);
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
