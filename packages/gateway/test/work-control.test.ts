import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo } from "@yonder/core";
import { expect, it } from "vitest";
import { testModel } from "../../core/src/config/test-support.js";
import { workControl } from "../src/work-control.js";

it("uses the real registry and stream snapshots without admin or local methods", async () => {
	const home = await mkdtemp(join("/tmp", "yw-"));
	await initHome(home, "owner", { model: testModel });
	const kernel = await openKernel(home);
	try {
		const host = workControl(
			{ kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
			"card",
		);
		const signal = new AbortController();
		const sessions = await host.request("owner", "sessions.list", {}, signal.signal);
		expect(Array.isArray(sessions)).toBe(true);
		await expect(host.request("owner", "management", {}, signal.signal)).rejects.toMatchObject({ code: "forbidden" });
		await expect(host.request("owner", "gateway.ticket", {}, signal.signal)).rejects.toMatchObject({
			code: "forbidden",
		});
		const frames: any[] = [];
		const stream = await host.open("owner", (frame) => frames.push(frame), signal.signal);
		stream.frame({ t: "sub", sub: "activity", method: "activity.watch", params: {} });
		for (let i = 0; i < 100 && !frames.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
		expect(frames[0]).toMatchObject({ t: "ready", sub: "activity", gap: true });
		stream.frame({ t: "unsub", sub: "activity" });
		expect(frames.at(-1)).toMatchObject({ t: "end", sub: "activity", reason: "unsub" });
		signal.abort();
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});
