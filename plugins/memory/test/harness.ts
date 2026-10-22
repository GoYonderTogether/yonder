import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { initialize } from "../src/files.js";
import plugin from "../src/index.js";
export const context = (event?: YEvent): ToolContext =>
	({
		agent: "test",
		profile: "test",
		session: "memory-test",
		capabilities: ["read", "write", "admin"],
		signal: new AbortController().signal,
		...(event ? { event } : {}),
	}) as ToolContext;
export function event(
	type = "message.in",
	from = "acct:test:owner",
	data: object = { text: "确定性测试输入" },
): YEvent {
	return { id: randomUUID(), ts: new Date().toISOString(), type, from, conv: "conv:test:owner", data };
}
export async function harness(extra = {}, overrides: Partial<PluginAPI> = {}) {
	const root = await mkdtemp(join(tmpdir(), "memory-test-"));
	await initialize(root);
	const { api, registrations } = createRegistrationCollector(),
		events: EventInput[] = [];
	const config = {
		root,
		owner: "person:test",
		timezone: "UTC",
		allowedAgents: ["test"],
		allowedSourceConversations: ["conv:test:owner"],
		...extra,
	};
	const full = {
		...api,
		config,
		identity: {
			async account(ref: string) {
				return ref === "acct:test:owner" ? { person: "person:test" } : undefined;
			},
		},
		events: {
			...api.events,
			async emit(e: EventInput) {
				events.push(e);
				return { ...e, id: randomUUID(), ts: new Date().toISOString() } as YEvent;
			},
		},
		...overrides,
	} as PluginAPI;
	await plugin.setup(full);
	return {
		root,
		config,
		api: full,
		registrations,
		events,
		async run(name: string, args: unknown, ctx = context(event())) {
			const tool = registrations.tools.find((t) => t.name === `memory_${name}`);
			if (!tool) throw new Error("missing tool");
			const result = await tool.execute(args, ctx);
			if (result.isError) throw new Error(result.text);
			return JSON.parse(result.text);
		},
		async dispose() {
			for (const t of [...registrations.triggers].reverse()) await t.stop();
			await rm(root, { recursive: true, force: true });
		},
	};
}
