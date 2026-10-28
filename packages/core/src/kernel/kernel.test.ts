import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { parseAgentConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import { initHome, inspectHome, manageHome, offlineQuery, openKernel } from "./index.js";

test("initialize, inspect, start, stop and query a real empty home", async () => {
	const home = await mkdtemp("/tmp/yonder-kernel-");
	try {
		await initHome(home, "owner", { model: testModel });
		expect(parse(await readFile(`${home}/yonder.yaml`, "utf8")).plugins).toContainEqual({
			use: "@yonder/plugin-ui-companion",
		});
		const file = `${home}/agents/main/agent.yaml`;
		const agent = parse((await readFile(file, "utf8")).replace("      channel: cli\n", ""));
		// 这条用例验证空 home；管家首次引导的唤醒由下一条用例覆盖。
		expect(agent.bindings.map((binding: { id: string }) => binding.id).sort()).toEqual(["onboarding", "owner", "peer"]);
		agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
		await writeFile(file, stringify(agent));
		expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
		await expect(initHome(home, "owner", { model: testModel })).rejects.toThrow();
		const kernel = await openKernel(home);
		try {
			expect((await kernel.identity.lookup("person:owner")).accounts.map((item) => item.ref)).toEqual([
				"acct:cli:local",
				"acct:console:owner",
			]);
			expect(await kernel.sessions.list({})).toEqual([]);
			expect(await kernel.awakeActivity()).toEqual({ active: 0 });
			expect(await kernel.terminal.activity()).toEqual([
				{ id: "main", name: expect.any(String), state: "idle", execution: { phase: "idle" }, tasks: [] },
			]);
			const endpoint = JSON.parse(await readFile(`${home}/.yonder/plugins/ui-companion/desktop.json`, "utf8"));
			expect((await fetch(endpoint.url)).status).toBe(200);
			expect(parse(await readFile(file, "utf8")).defaults.plugins).not.toContain("ui-companion");
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

test("first start wakes the butler for onboarding once, until onboarding.done", async () => {
	const home = await mkdtemp("/tmp/yonder-onboarding-");
	try {
		await initHome(home, "owner", { model: testModel });
		const agent = parseAgentConfig(await readFile(`${home}/agents/main/agent.yaml`, "utf8"), "agent.yaml");
		expect(agent.defaults?.plugins).toEqual(expect.arrayContaining(["tasks", "onboarding"]));
		expect(agent.defaults?.model).toBeUndefined();
		const kernel = await openKernel(home);
		try {
			const started = (await kernel.events.query({ type: "onboarding.start" })).events;
			expect(started).toMatchObject([{ from: "plugin:onboarding", conv: "conv:onboarding:main" }]);
			expect((await kernel.sessions.list({})).map((session) => session.key)).toEqual(["main"]);
		} finally {
			await kernel.close();
		}
		await mkdir(`${home}/.yonder/plugins/onboarding/agents`, { recursive: true });
		await writeFile(`${home}/.yonder/plugins/onboarding/agents/main.json`, JSON.stringify({ tasks: {}, done: "x" }));
		const restarted = await openKernel(home);
		try {
			expect((await restarted.events.query({ type: "onboarding.start" })).events).toHaveLength(1);
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
		await initHome(home, "owner", { model: testModel });
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
		await rm(`${home}/agents/main/SOUL.md`);
		await writeFile(file, stringify({ ...agent, defaults: { ...agent.defaults, contexts: ["soul-md"] } }));
		await expect
			.poll(() => readFile(`${home}/agents/main/SOUL.md`, "utf8").catch(() => ""), { timeout: 8000 })
			.toContain("Who you are");
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

test("offline inspection uses the common tool policy and includes preset plugin references", async () => {
	const home = await mkdtemp("/tmp/yonder-inspect-");
	try {
		await initHome(home, "owner", { model: testModel });
		const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
		config.plugins.push({ use: "@yonder/plugin-browser-skill" });
		await writeFile(`${home}/yonder.yaml`, stringify(config));
		await writeFile(
			`${home}/presets/browser.yaml`,
			stringify({
				schema: 1,
				description: "Browser maintenance",
				plugins: ["browser-skill"],
				model: "openai/gpt-6-luna",
			}),
		);
		const file = `${home}/agents/main/agent.yaml`;
		const agent = parse(await readFile(file, "utf8"));
		agent.profiles.owner = { capabilities: ["read"], tools: { offer: ["read"], search: ["task_run"] } };
		await writeFile(file, stringify(agent));
		const report = (await manageHome(home, { action: "inspect" })) as {
			tools: Array<{ name: string; exposure: string }>;
		};
		expect(report.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "read", exposure: "offer" }),
				expect.objectContaining({ name: "task_run", exposure: "search" }),
				expect.objectContaining({ name: "tool_search", exposure: "offer" }),
				expect.objectContaining({ name: "bash", exposure: "capability-denied" }),
			]),
		);
		const plugin = (await manageHome(home, { action: "plugins.show", id: "browser-skill" })) as {
			selectedBy: string[];
		};
		expect(plugin.selectedBy).toContain("preset:browser");
		config.plugins.push({ use: "/no-such-yonder-plugin" });
		await writeFile(`${home}/yonder.yaml`, stringify(config));
		expect(await manageHome(home, { action: "models.list" })).toHaveProperty("models");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
