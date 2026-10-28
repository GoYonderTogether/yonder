import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { parseAgentConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import { pluginDataPath } from "../plugins/index.js";
import { initHome, inspectHome, manageHome, offlineQuery, openKernel } from "./index.js";

test("initialize, inspect, start, stop and query a real empty home", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		await initHome(home, "owner", { model: testModel });
		expect(parse(await readFile(`${home}/yonder.yaml`, "utf8")).plugins).toContainEqual({
			use: "@yonder/plugin-interaction",
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
			expect(kernel.views.list({})).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: "interaction.card" })]),
			);
			await expect(readFile(`${home}/.yonder/plugins/interaction/desktop.json`, "utf8")).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(parse(await readFile(file, "utf8")).defaults.plugins).not.toContain("interaction");
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

test("onboarding never wakes the butler while its default model has no auth", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const agent = parseAgentConfig(await readFile(`${home}/agents/main/agent.yaml`, "utf8"), "agent.yaml");
		expect(agent.defaults?.plugins).toEqual(expect.arrayContaining(["tasks", "onboarding", "learning"]));
		expect(agent.defaults?.model).toBeUndefined();
		expect(agent.bindings.find((binding) => binding.id === "onboarding")?.match).toEqual({
			type: "onboarding.start",
			conv: "conv:onboarding:main",
		});
		// A fresh home has no .yonder/auth.json, so the default model has no auth.
		const kernel = await openKernel(home);
		try {
			expect((await kernel.events.query({ type: "onboarding.start" })).events).toEqual([]);
			expect(await kernel.sessions.list({})).toEqual([]);
		} finally {
			await kernel.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real first start: the butler runs an onboarding turn once, records one task per item, and is not woken again",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "ya-"));
		try {
			await initHome(home, "owner", { model: testModel });
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const state = join(pluginDataPath(home, "onboarding"), "agents", "main.json");
			const kernel = await openKernel(home);
			try {
				const [start] = (await kernel.events.query({ type: "onboarding.start" })).events;
				expect(start).toMatchObject({ from: "plugin:onboarding", conv: "conv:onboarding:main" });
				let ended: YEvent | undefined;
				for (let i = 0; i < 180 && !ended; i++) {
					await new Promise((done) => setTimeout(done, 1000));
					ended = (await kernel.events.query({ type: "run.end", conv: "conv:onboarding:main" })).events[0];
				}
				expect(ended).toMatchObject({ from: "agent:main", data: { status: "done", inputs: [start!.id] } });
				const recorded = JSON.parse(await readFile(state, "utf8"));
				expect(Object.keys(recorded.tasks).sort()).toEqual(["channels", "credentials", "gateway", "model", "plugins"]);
				expect(recorded.wakes).toBe(1);
			} finally {
				await kernel.close();
			}
			// Within the daily interval a restart does not wake again.
			const restarted = await openKernel(home);
			try {
				expect((await restarted.events.query({ type: "onboarding.start" })).events).toHaveLength(1);
			} finally {
				await restarted.close();
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
	240_000,
);

test("reload validates references, scaffolds contexts and retains an open session's preset", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
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
	const home = await mkdtemp(join(tmpdir(), "ya-"));
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
