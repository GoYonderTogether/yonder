import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test("real home publishes agent and preset management without restarting or invoking a model", async () => {
	const home = await mkdtemp("/tmp/yonder-management-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home);
		kernel = await openKernel(home);
		const manage = kernel.management;
		await manage({
			action: "presets.create",
			id: "managed",
			value: { description: "Management validation", model: "openai/gpt-6-luna", level: "readonly" },
		});
		expect(kernel.terminal.presets().some((p) => p.id === "managed")).toBe(true);
		const result = await manage({
			action: "agents.create",
			id: "managed",
			preset: "managed",
			value: { name: "管理验证", work: "配置验收", owner: "person:owner", bindings: [] },
		});
		expect(result).toMatchObject({ accepted: true, valid: true, messageEntry: false });
		expect(await readFile(`${home}/agents/managed/SYSTEM.md`, "utf8")).toContain("#");
		await manage({ action: "agents.update", id: "managed", value: { name: "更新名字", work: "更新工作" } });
		expect(await manage({ action: "agents.show", id: "managed" })).toMatchObject({
			name: "更新名字",
			work: "更新工作",
		});
		const original = await readFile(`${home}/agents/managed/agent.yaml`, "utf8");
		await expect(
			manage({
				action: "agents.update",
				id: "managed",
				value: { profiles: { default: { model: "unknown/not-real" } } },
			}),
		).rejects.toThrow("unknown model");
		expect(await readFile(`${home}/agents/managed/agent.yaml`, "utf8")).toBe(original);
		await expect(manage({ action: "agents.create", id: "managed", preset: "managed", value: {} })).rejects.toThrow(
			"already registered",
		);
		await manage({ action: "agents.archive", id: "managed" });
		expect(await manage({ action: "agents.show", id: "managed" })).toHaveProperty("archivedAt");
		await manage({ action: "agents.restore", id: "managed" });
		expect(await manage({ action: "agents.show", id: "managed" })).not.toHaveProperty("archivedAt");
		await expect(manage({ action: "agents.archive", id: "main" })).rejects.toThrow("daily entry");
		const session = await kernel.sessions.open({ preset: "managed" });
		await expect(manage({ action: "presets.remove", id: "managed" })).rejects.toThrow(`session ${session.id}`);
		await kernel.sessions.close(session.id);
		await manage({ action: "presets.update", id: "managed", value: { description: "Changed description" } });
		expect(kernel.terminal.presets().find((p) => p.id === "managed")?.description).toBe("Changed description");
		await manage({ action: "presets.remove", id: "managed" });
		expect(kernel.terminal.presets().some((p) => p.id === "managed")).toBe(false);
		await Promise.all([
			manage({ action: "presets.create", id: "one", value: { description: "Concurrent first preset" } }),
			manage({ action: "presets.create", id: "two", value: { description: "Concurrent second preset" } }),
		]);
		expect(kernel.terminal.presets().map((p) => p.id)).toEqual(expect.arrayContaining(["one", "two"]));
		const root = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
		root.compaction = {};
		await writeFile(`${home}/yonder.yaml`, stringify(root));
		expect(await manage({ action: "agents.update", id: "managed", value: { work: "更新工作" } })).toMatchObject({
			restartRequired: true,
		});
		expect(parse(await readFile(`${home}/yonder.yaml`, "utf8")).compaction).toEqual({});
		// An externally invalid registry must retain the complete effective snapshot.
		await writeFile(
			`${home}/yonder.yaml`,
			stringify({ schema: 1, agents: [{ id: "missing", workspace: "./agents/missing" }] }),
		);
		await expect
			.poll(
				async () =>
					(await kernel!.events.query({ type: "config.reload" })).events.some(
						(e) => (e.data as { ok: boolean }).ok === false,
					),
				{ timeout: 5000 },
			)
			.toBe(true);
		expect(await manage({ action: "agents.show", id: "managed" })).toMatchObject({ name: "更新名字" });
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
