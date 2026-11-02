import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "@yonder/local-host/config/test-support";
import { attachmentFromPath } from "@yonder/runtime-adapter/node/runtime/attachments";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db";
import { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import { createStore } from "@yonder/local-host/store/index";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"owner bypass snapshot stays frozen and a channel steer starts a separate readonly run",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-owner-snapshot-"));
		const db = await openDatabase(join(home, "state.db")),
			store = await createStore(db);
		let id = "";
		const runtime = await Runtime.open({
			home,
			storage: await openRuntimeStorage(db),
			config: { schema: 1, credentials: auth },
			readEvent: store.events.get,
			resolveSession: async () => ({
				sessionId: id,
				sessionMode: "main",
				agent: null,
				profile: "readonly",
				cwd: home,
				resolved: resolveProfile({ level: "readonly", tools: { offer: ["read", "bash"] }, limits: { maxMinutes: 2 } }),
			}),
		});
		try {
			id = await runtime.create({ agent: null, profile: "readonly", cwd: home });
			const state = (await runtime.sessionState(id))!;
			await runtime.setSessionState(id, {
				...state,
				workbench: {
					permission: { id: "bypass", level: "bypass", capabilities: resolveProfile({ level: "bypass" }).capabilities },
				},
			});
			const attachment = await attachmentFromPath(resolve("packages/device/package.json"));
			const text = `Read the attached file at ${resolve("packages/device/package.json")} using read and identify its package name. Then call bash with command 'sleep 2; printf owner-finished'. Reply with the package name and owner-finished.`;
			const event = await store.events.record({
				type: "message.in",
				from: "acct:console:owner",
				data: { ownerWorkbench: true, text, attachments: [attachment] },
			});
			let runningTool = false;
			const first = runtime.submit(id, {
				event,
				text,
				attachments: [attachment],
				onOutput: (part) => {
					if (part.type === "tool" && part.phase === "start") runningTool = true;
				},
			});
			await expect.poll(() => runningTool, { timeout: 60000 }).toBe(true);
			await runtime.setSessionState(id, {
				...(await runtime.sessionState(id))!,
				workbench: { permission: { id: "readonly", level: "readonly", capabilities: ["read"] } },
			});
			const channelText = `Use bash to write channel-owned into ${join(home, "should-not-exist")}. If you cannot, state that limitation without tools.`;
			const channel = await store.events.record({
				type: "message.in",
				from: "acct:card:visitor",
				data: { text: channelText, ownerWorkbench: true },
			});
			const second = runtime.submit(id, { event: channel, text: channelText, busy: "steer" });
			const [owner, visitor] = await Promise.all([first, second]);
			expect(owner.status).toBe("done");
			expect(owner.text).toMatch(/@\s*yonder\/device/);
			expect(owner.text).toContain("owner-finished");
			expect(owner.config?.ownerWorkbench).toBe(true);
			expect(owner.config?.resolved.capabilities).toContain("exec");
			expect(visitor.status).toBe("done");
			expect(visitor.runId).not.toBe(owner.runId);
			expect(visitor.config?.ownerWorkbench).not.toBe(true);
			expect(visitor.config?.resolved.capabilities).not.toContain("exec");
			await expect(readFile(join(home, "should-not-exist"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await runtime.close();
			await db.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
