import { mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("console sends effort commands through the shared channel without a model run", async () => {
	const home = await mkdtemp("/tmp/ya-effort-");
	await initHome(home, "owner", { model: testModel });
	const kernel = await openKernel(home);
	try {
		const sent = await kernel.bots.send("main", "/effort low");
		await expect
			.poll(async () => (await kernel.events.query({ type: "channel.command.result" })).events.length)
			.toBe(1);
		const results = (await kernel.events.query({ type: "channel.command.result" })).events;
		expect(results[0]?.data).toMatchObject({ session: sent.session, command: "effort low", status: "done" });
		expect(await kernel.sessions.command(sent.session, "effort")).toContain("Effort: low");
		expect((await kernel.events.query({ type: "run.start" })).events).toHaveLength(0);
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);
