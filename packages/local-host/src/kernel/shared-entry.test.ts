import { rm } from "node:fs/promises";
import * as shared from "@yonder/bot-core";
import { Runtime } from "@yonder/runtime-adapter";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import { initHome } from "./home.js";
import { openKernel } from "./index.js";

test("the local kernel initializes its real services through the shared createBot entry", async () => {
	const home = await tempHome("shared-bot-entry-");
	await initHome(home, "owner", { bundle: "core", model: "openai/gpt-6-luna" });
	const entered = vi.spyOn(shared, "createBot");
	const maintained = vi.spyOn(Runtime.prototype, "maintenance");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		kernel = await openKernel(home);
		expect(entered).toHaveBeenCalledTimes(1);
		expect(entered.mock.calls[0]![0].plugins.descriptors.length).toBeGreaterThan(0);
		expect(kernel.channels.list().some(({ instance }) => instance === "console")).toBe(true);
		expect(await kernel.sessions.list({})).toEqual([]);
		await vi.waitFor(() => expect(maintained).toHaveBeenCalled(), { timeout: 18000, interval: 25 });
	} finally {
		await kernel?.close();
		entered.mockRestore();
		maintained.mockRestore();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
