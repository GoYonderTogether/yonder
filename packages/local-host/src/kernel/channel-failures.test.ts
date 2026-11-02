import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import type { AgentConfig, YonderConfig } from "@yonder/local-host/config/index";
import { configurationErrors } from "@yonder/local-host/kernel/home";
import { type KernelServices, loadPlugins } from "@yonder/local-host/plugins/index";
import type { Models } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";

const unused = async (): Promise<never> => {
	throw new Error("unexpected external service access");
};

test.for([
	["invalid config", "unit"],
	["missing credential", "unit"],
	["invalid config", "socket"],
	["missing credential", "socket"],
])("QQ %s leaves a bound healthy CLI usable (%s)", async ([failure, mode], context) => {
	const home = await tempHome("channel-failures-");
	const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
	try {
		const config = {
			schema: 1,
			plugins: [{ use: "@yonder/plugin-channel-cli" }, { use: "@yonder/plugin-channel-qq" }],
			channels: {
				cli: { type: "cli" },
				qq: { type: "qq", ...(failure === "missing credential" ? { appId: "1", credential: "missing" } : {}) },
			},
		} as YonderConfig;
		const plugins = await loadPlugins(home, config, {
			credentials: { get: async () => undefined },
			log,
		} as unknown as KernelServices);
		const agent = {
			id: "main",
			profiles: {},
			bindings: [
				{ id: "qq-dm", match: { channel: "qq", kind: "dm" } },
				{ id: "qq-group", match: { channel: "qq", kind: "group" } },
				{ id: "cli", match: { channel: "cli", kind: "dm" } },
			],
		} as unknown as AgentConfig;
		const errors = () => configurationErrors(config, new Map([[agent.id, agent]]), plugins, {} as Models, new Map());
		expect(errors()).toEqual([]);
		const cli = plugins.channels.get("cli");
		assert(cli);
		// Exercise real plugin loading and QQ startup; the healthy CLI lifecycle needs no socket.
		const start = vi.spyOn(cli, "start");
		const stop = vi.spyOn(cli, "stop");
		if (mode === "unit") {
			start.mockResolvedValue();
			stop.mockResolvedValue();
		}
		try {
			await plugins.start({ emit: unused, ask: unused });
		} catch (error) {
			if (mode === "socket" && (error as NodeJS.ErrnoException).code === "EPERM")
				context.skip("Environment forbids the CLI local socket (EPERM); lifecycle unit regression runs separately");
			throw error;
		}
		expect(start).toHaveBeenCalledOnce();
		expect(stop).not.toHaveBeenCalled();
		if (failure === "invalid config") expect(plugins.channelErrors.get("qq")).toContain("appId");
		else {
			const tool = plugins.tools.get("channel-qq")?.find((t) => t.name === "channel-qq_status");
			assert(tool);
			const result = await tool.execute({}, {} as import("@yonder/sdk").ToolContext);
			expect(JSON.parse(result.text).instances).toMatchObject([
				{ state: "unavailable", error: "QQ credential unavailable: missing" },
			]);
		}
		expect(log.error).toHaveBeenCalled();
		agent.bindings = [{ id: "unknown", match: { channel: "unknown", kind: "dm" } }] as AgentConfig["bindings"];
		expect(errors()).toContain("main/unknown: unknown channel unknown");
		agent.bindings = [{ id: "wrong-kind", match: { channel: "cli", kind: "group" } }] as AgentConfig["bindings"];
		expect(errors()).toContain("main/wrong-kind: no selected channel declares kind group");
		await plugins.stop();
		expect(stop).toHaveBeenCalledOnce();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
