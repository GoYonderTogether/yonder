import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "../kernel/index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"manual task continues, reports native tools, survives restart and closes explicitly",
	async () => {
		const home = await mkdtemp("/tmp/ytu-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: testModel });
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			kernel = await openKernel(home);
			const session = await kernel.sessions.open({ preset: "default", close: "manual" });
			expect(session.close).toBe("manual");
			const updates: Array<{ type: string }> = [];
			const stop = await kernel.terminal.observe(session.id, async (update) => {
				updates.push(update);
			});
			expect(updates[0]?.type).toBe("snapshot");
			const first = await kernel.sessions.submit(
				session.id,
				{
					text: "Use bash to run pwd. Then reply with the directory and remember the word terminal-continuity for my next question.",
				},
				{ wait: true },
			);
			expect(first?.status).toBe("done");
			expect(first?.text).toContain(home);
			expect((await kernel.sessions.get(session.id))?.closed).toBeUndefined();
			expect(updates.some((update) => update.type === "tool")).toBe(true);
			await stop();
			await kernel.close();
			kernel = await openKernel(home);
			expect((await kernel.sessions.get(session.id))?.close).toBe("manual");
			const second = await kernel.sessions.submit(
				session.id,
				{ text: "What word did I ask you to remember? Reply only that word." },
				{ wait: true },
			);
			expect(second?.text).toContain("terminal-continuity");

			const abortable = await kernel.sessions.open({ preset: "default", close: "manual" });
			let toolStarted = false;
			const release = await kernel.terminal.observe(abortable.id, async (update) => {
				if (update.type === "tool" && update.tool?.phase === "start") toolStarted = true;
			});
			await kernel.terminal.submit(abortable.id, {
				text: "Call bash now with command: sleep 10; printf abort-check. Wait for the tool before replying.",
			});
			await expect.poll(() => toolStarted, { timeout: 30000 }).toBe(true);
			const queued = await kernel.terminal.submit(
				abortable.id,
				{ text: "Queued input must be returned to the editor." },
				"followup",
			);
			const current = kernel;
			await expect.poll(async () => (await current.terminal.queued(abortable.id)).length, { timeout: 3000 }).toBe(1);
			const withdrawn = await kernel.terminal.queued(abortable.id, true);
			expect(withdrawn[0]?.text).toBe("Queued input must be returned to the editor.");
			expect(withdrawn[0]?.event).toBe(queued.event);
			await kernel.sessions.abort(abortable.id);
			expect((await kernel.sessions.get(abortable.id))?.closed).toBeUndefined();
			await release();
			await kernel.sessions.close(abortable.id);
			const once = await kernel.sessions.open({ preset: "default" });
			expect(once.close).toBe("run-end");
			expect(
				(await kernel.sessions.submit(once.id, { text: "Reply only: one-shot-complete" }, { wait: true }))?.status,
			).toBe("done");
			expect((await kernel.sessions.get(once.id))?.closed).toBeTruthy();
			await kernel.sessions.close(session.id);
			expect((await kernel.sessions.get(session.id))?.closed).toBeTruthy();
			await expect(kernel.sessions.submit(session.id, { text: "must reject" })).rejects.toThrow("Not an open task");
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	120000,
);
