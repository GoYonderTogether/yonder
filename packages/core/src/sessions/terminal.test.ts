import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"manual task continues, reports native tools, survives restart and closes explicitly",
	async () => {
		const home = await mkdtemp("/tmp/ytu-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home);
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
