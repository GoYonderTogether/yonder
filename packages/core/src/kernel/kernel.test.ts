import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { parseAgentConfig } from "../config/index.js";
import { initHome, inspectHome, offlineQuery, openKernel } from "./index.js";

test("initialize, inspect, start, stop and query a real empty home", async () => {
	const home = await mkdtemp("/tmp/yonder-kernel-");
	try {
		await initHome(home);
		const file = `${home}/agents/main/agent.yaml`;
		await writeFile(file, (await readFile(file, "utf8")).replace("      channel: cli\n", ""));
		expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
		await expect(initHome(home)).rejects.toThrow();
		const kernel = await openKernel(home);
		try {
			expect((await kernel.identity.lookup("person:owner")).accounts.map((item) => item.ref)).toEqual([
				"acct:cli:local",
			]);
			expect(await kernel.sessions.list({})).toEqual([]);
			await kernel.identity.unlink("acct:cli:local");
			await kernel.identity.createPerson({ id: "owner", name: "Renamed owner" });
		} finally {
			await kernel.close();
		}
		expect(await offlineQuery(home, { method: "sessions.list" })).toEqual([]);
		const restarted = await openKernel(home);
		try {
			expect((await restarted.identity.account("acct:cli:local"))?.person).toBeUndefined();
			expect((await restarted.identity.person("person:owner"))?.name).toBe("Renamed owner");
		} finally {
			await restarted.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("reload validates references, scaffolds contexts and retains an open session's preset", async () => {
	const home = await mkdtemp("/tmp/yonder-reload-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home);
		await mkdir(`${home}/presets`, { recursive: true });
		const preset = `${home}/presets/maintenance.yaml`;
		await writeFile(
			preset,
			"schema: 1\ndescription: N01 configuration reload verification\nmodel: openai/gpt-6-luna\nlevel: readonly\n",
		);
		kernel = await openKernel(home);
		const running = kernel;
		const file = `${home}/agents/main/agent.yaml`;
		const agent = parseAgentConfig(await readFile(file, "utf8"));
		await writeFile(file, stringify({ ...agent, defaults: { ...agent.defaults, model: "openai/N01-invalid-model" } }));
		await expect
			.poll(
				async () =>
					(await running.events.query({ type: "config.reload" })).events.some((event) =>
						JSON.stringify(event.data).includes("unknown model"),
					),
				{ timeout: 8000 },
			)
			.toBe(true);
		await writeFile(file, stringify({ ...agent, defaults: { ...agent.defaults, contexts: ["soul-md"] } }));
		await expect
			.poll(() => readFile(`${home}/agents/main/SOUL.md`, "utf8").catch(() => ""), { timeout: 8000 })
			.toContain("行为方式");
		await kernel.sessions.open({ preset: "maintenance" });
		await rm(preset);
		await expect
			.poll(
				async () =>
					(await running.events.query({ type: "config.reload" })).events.some((event) =>
						JSON.stringify(event.data).includes("close session before removing"),
					),
				{ timeout: 8000 },
			)
			.toBe(true);
		expect(await kernel.sessions.open({ preset: "maintenance" })).toHaveProperty("profile", "maintenance");
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
