import { mkdtemp, rm } from "node:fs/promises";
import { expect, test } from "vitest";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("background commands use the console channel and session command without invoking a model", async () => {
	const home = await mkdtemp("/tmp/ya-bg-");
	await initHome(home, "owner", { model: testModel });
	const kernel = await openKernel(home);
	try {
		const sent = await kernel.bots.send("main", "/bg");
		await expect
			.poll(async () => (await kernel.events.query({ type: "channel.command.result" })).events.length)
			.toBe(1);
		const results = (await kernel.events.query({ type: "channel.command.result" })).events;
		expect(results[0]?.data).toMatchObject({ session: sent.session, command: "bg", status: "done" });
		expect(JSON.parse(await kernel.sessions.command(sent.session, "bg"))).toEqual([]);
		await expect(kernel.sessions.command(sent.session, "bg logs 999999999")).rejects.toThrow("not found");
		await expect(kernel.sessions.command(sent.session, "bg kill 999999999")).rejects.toThrow("not found");
		await expect(kernel.sessions.command(sent.session, "bg logs")).rejects.toThrow("用法：/bg");
		expect((await kernel.events.query({ type: "run.start" })).events).toHaveLength(0);
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);
