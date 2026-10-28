import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("terminal template discovery matches a task preset before and after opening", async () => {
	const home = await mkdtemp(join(tmpdir(), "yt-"));
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "owner", { model: testModel });
		await mkdir(join(home, "presets/default/prompts"), { recursive: true });
		await writeFile(join(home, "presets/default/prompts/review.md"), "---\ndescription: Review work\n---\n$1");
		kernel = await openKernel(home);
		expect(await kernel.terminal.templates(undefined, "default")).toContainEqual({
			name: "review",
			description: "Review work",
		});
		const session = await kernel.sessions.open({ preset: "default" });
		expect(await kernel.terminal.templates(session.id)).toContainEqual({ name: "review", description: "Review work" });
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
});
