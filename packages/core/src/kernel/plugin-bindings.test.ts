import type { AgentBindingRequest, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { type AgentConfig, resolveProfile } from "../config/index.js";
import { createPluginBindings } from "./plugin-bindings.js";

test("private plugin bindings validate owner routes, remain scoped and detect revocation", async () => {
	const agent: AgentConfig = {
		schema: 1,
		id: "main",
		name: "Main",
		owner: "person:owner",
		defaultProfile: "owner",
		profiles: { owner: { level: "bypass", plugins: ["archive"] } },
		bindings: [{ id: "owner", match: { from: "owner", kind: "dm" }, session: "main", profile: "owner" }],
	};
	const agents = new Map([[agent.id, agent]]);
	const request: AgentBindingRequest = {
		id: "updates",
		eventType: "archive.watch",
		conv: "conv:archive:watch:main:updates",
		profile: "owner",
		notification: { to: "owner", via: "test" },
	};
	const owner = { session: "1", agent: "main", profile: "owner" };
	const ctx = {
		...owner,
		capabilities: ["read", "write", "admin"],
		event: { type: "message.in", from: "acct:test:owner", data: { kind: "dm" } },
	} as ToolContext;
	let assertCalls = 0;
	let writable = true;
	let sendAvailable = true;
	let linked = true;
	const service = createPluginBindings({
		config: { schema: 1, defaultModel: "openai/gpt-6-luna" },
		agents,
		assert: (actual) => {
			assertCalls++;
			if (actual !== ctx) throw new Error("Invalid native context");
		},
		resolve: async (actual) => {
			if (actual.session !== owner.session || actual.profile !== owner.profile || actual.agent !== owner.agent)
				throw new Error("Execution owner does not match the stored session");
			return {
				...owner,
				cwd: "",
				owner: agent.owner,
				resolved: resolveProfile(
					writable ? agent.profiles.owner! : { level: "readonly" },
					{},
					"local",
					"openai/gpt-6-luna",
				),
			};
		},
		owner: async (_agent, account) => linked && account === "acct:test:owner",
		target: async (notification) => (notification.to === "owner" ? "acct:test:owner" : notification.to),
		hasSend: () => sendAvailable,
		update: async (_agent, binding) => {
			agent.bindings = [...agent.bindings.filter((item) => item.id !== binding.id), binding];
		},
	});
	await expect(service.configureBinding(request, "other", ctx)).rejects.toThrow("namespace");
	await expect(service.configureBinding(request, "archive", { ...ctx })).rejects.toThrow("native context");
	expect(agent.bindings).toHaveLength(1);
	const route = await service.configureBinding(request, "archive", ctx);
	expect(assertCalls).toBe(3);
	expect(route).toMatchObject({
		binding: "archive:updates",
		notification: { to: "acct:test:owner", via: "test" },
		owner,
	});
	expect(agent.bindings.at(-1)).toMatchObject({
		session: { mode: "persistent", per: "conv" },
		reply: "none",
		wake: "run",
	});
	expect(await service.inspectBinding(request, "archive", owner)).toEqual(route);
	const peer: AgentConfig = { ...agent, id: "peer", bindings: [] };
	agents.set(peer.id, peer);
	agent.bindings.push({
		id: "peer",
		match: { channel: "agent", kind: ["agent", "parent-request"], from: "acct:agent:peer" },
		session: "main",
		profile: "owner",
	});
	expect(await service.inspectBinding(request, "archive", owner)).toEqual(route);
	peer.owner = "person:another";
	await expect(service.inspectBinding(request, "archive", owner)).rejects.toThrow("group or visitor");
	peer.owner = agent.owner;
	agent.bindings.pop();

	await expect(service.inspectBinding(request, "archive", { ...owner, agent: "other" })).rejects.toThrow(
		"does not match",
	);
	for (const setting of ["send", "owner", "write"] as const) {
		sendAvailable = setting !== "send";
		linked = setting !== "owner";
		writable = setting !== "write";
		await expect(service.inspectBinding(request, "archive", owner)).rejects.toThrow();
	}
	sendAvailable = linked = writable = true;
	agent.bindings[0]!.match = { kind: "group" };
	await expect(service.inspectBinding(request, "archive", owner)).rejects.toThrow("group or visitor");
	agent.bindings[0]!.match = { kind: "dm", from: "owner" };
	agent.bindings.at(-1)!.reply = "auto";
	await expect(service.inspectBinding(request, "archive", owner)).rejects.toThrow("changed or removed");
});
