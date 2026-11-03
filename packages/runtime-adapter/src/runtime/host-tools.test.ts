import { rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveProfile } from "@yonder/bot-definition";
import type { Tool } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { openNodeRuntime } from "../node/open-runtime.js";
import { openDatabase, openRuntimeStorage } from "../node/runtime/db.js";
import { hostToolSignature, refreshHostTools } from "./host-tools.js";
import type { RuntimeInternals } from "./instance.js";

test("host registry refresh cannot expand another session's frozen tool set or replace its schema", async () => {
	const home = await tempHome("yonder-host-tools-");
	let runtime: Awaited<ReturnType<typeof openNodeRuntime>> | undefined;
	try {
		let online: string[] = [];
		const config = {
			agent: "owner",
			profile: "default",
			cwd: home,
			resolved: resolveProfile({ model: "openai/gpt-6-luna", tools: { offer: ["*"] }, capabilities: ["read"] }),
		};
		runtime = await openNodeRuntime({
			home,
			storage: await openRuntimeStorage(await openDatabase(join(home, "state.db"))),
			config: { schema: 1 },
			resolveSession: async () => config,
			refreshHostTools: async () => online,
		});
		const first: Tool = {
			name: "device_first",
			description: "First authorized target",
			parameters: Type.Object({}),
			capabilities: ["read"],
			execute: async () => ({ text: "first" }),
		};
		const second: Tool = { ...first, name: "device_second", description: "Second authorized target" };
		const frozen = {
			...config,
			hostTools: [{ name: first.name, signature: hostToolSignature(first), capabilities: first.capabilities }],
		};
		runtime.setHostTools([first]);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === first.name && tool.exposure === "offer")).toBe(
			true,
		);
		runtime.setHostTools([second]);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === second.name)).toBe(false);
		expect(runtime.describeTools(config).some((tool) => tool.name === first.name)).toBe(false);
		online = [];
		await refreshHostTools(runtime as unknown as RuntimeInternals, frozen);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === first.name)).toBe(false);
		online = [first.name, second.name];
		await refreshHostTools(runtime as unknown as RuntimeInternals, frozen);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === first.name && tool.exposure === "offer")).toBe(
			true,
		);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === second.name)).toBe(false);

		const changed: Tool = { ...first, parameters: Type.Object({ path: Type.String() }) };
		runtime.setHostTools([changed]);
		expect(runtime.describeTools(frozen).some((tool) => tool.name === first.name)).toBe(false);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
