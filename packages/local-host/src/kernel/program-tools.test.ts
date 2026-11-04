import type { Store } from "@yonder/bot-core/store/contracts";
import type { AgentConfig, YonderConfig } from "@yonder/bot-definition";
import type { ProgramToolsRuntime } from "@yonder/local-host/kernel/program-tools";
import { createProgramTools } from "@yonder/local-host/kernel/program-tools";
import { expect, test } from "vitest";

const source = {
	instance: "card" as const,
	cloudBotId: "cloud-bot",
	ownerId: "cloud-owner",
	deviceId: "physical-device",
	platformAgentId: "platform-agent",
	callerSession: "cloud-session",
	invocationId: "run-17",
	sourceMessageIds: ["message-1"],
};

function fixture(endpoint = "https://card.example") {
	const acceptedAgent = {
		id: "local-agent",
		owner: "person:local-owner",
		defaultProfile: "default",
		profiles: {
			default: {
				model: "openai/gpt-6-luna",
				capabilities: ["read", "write"],
				channelInstances: ["card", "other"],
			},
			other: {
				model: "openai/gpt-6-luna",
				capabilities: ["read", "write"],
				channelInstances: ["card", "other"],
			},
		},
		defaults: {},
		bindings: [],
	} as unknown as AgentConfig;
	const config = {
		agents: [{ id: "local-agent", workspace: "agents/a", env: "local" }],
		channels: { card: { type: "card", endpoint } },
		defaultModel: "openai/gpt-6-luna",
	} as unknown as YonderConfig;
	const rows = new Map<string, unknown>();
	const store = {
		sessions: {
			get: async (id: string) => rows.get(id),
			put: async (row: { id: string }) => {
				rows.set(row.id, row);
				return row;
			},
		},
	} as unknown as Store;
	const calls: unknown[][] = [];
	const sessions = new Map<string, string>();
	const runtime = {
		catalogProgramTools: (resolved: unknown) => {
			calls.push(["catalog", resolved]);
			return [
				{
					name: "files_read",
					description: "Read files",
					parameters: {},
					capabilities: ["read"],
					exposure: "offer",
				},
			];
		},
		programConversationId: async (scope: string, resolved: unknown) => {
			calls.push(["conversation", scope, resolved]);
			let id = sessions.get(scope);
			if (!id) {
				id = sessions.size === 0 ? "program-session" : `program-session-${sessions.size + 1}`;
				sessions.set(scope, id);
			}
			return id;
		},
		callProgramTool: async (request: unknown) => {
			calls.push(["call", request]);
			return { text: "read result" };
		},
	} as unknown as ProgramToolsRuntime;
	return {
		calls,
		rows,
		acceptedAgent,
		tools: createProgramTools({
			agents: new Map([["local-agent", acceptedAgent]]),
			config,
			home: "/device/home",
			store,
			version: "test-version",
			contexts: new Map(),
			runtime: () => runtime,
		}),
	};
}

test("program tools use accepted default profile, physical resource ceiling, and isolated persistent session", async () => {
	const { calls, rows, tools } = fixture();
	const input = {
		agent: "local-agent",
		source,
		ceiling: {
			capabilities: ["read" as const],
			channelInstances: ["card"],
			resources: [{ deviceId: source.deviceId, paths: ["/device/home/agents/a/notes"] }],
		},
		tool: "files_read",
		arguments: { path: "notes/today.md" },
	};
	await expect(tools.call(input, "card", new AbortController().signal)).resolves.toEqual({ text: "read result" });
	expect(calls[0]?.[0]).toBe("catalog");
	const resolved = calls[0]?.[1] as {
		agent: string;
		profile: string;
		cwd: string;
		resolved: { capabilities: string[]; channelInstances?: string[] };
		resources: { deviceId: string; paths: string[] }[];
	};
	expect(resolved).toMatchObject({
		agent: "local-agent",
		profile: "default",
		cwd: "/device/home/agents/a",
		resolved: { capabilities: ["read"], channelInstances: ["card"] },
		resources: [{ deviceId: "local", paths: ["/device/home/agents/a/notes"] }],
	});
	const scope = calls.find((entry) => entry[0] === "conversation")?.[1];
	expect(typeof scope).toBe("string");
	expect(JSON.parse(scope as string)[2]).toBe("https://card.example");
	expect(calls.find((entry) => entry[0] === "call")?.[1]).toMatchObject({
		scope,
		invocation: "run-17",
		tool: "files_read",
	});
	expect(rows.get("program-session")).toMatchObject({
		id: "program-session",
		agent: "local-agent",
		profile: "default",
		mode: "persistent",
		key: scope,
		version: "test-version",
	});
});

test("program conversation scope separates devices using the same Card instance name at different endpoints", async () => {
	const first = fixture("https://card-one.example");
	const second = fixture("https://card-two.example");
	const input = {
		agent: "local-agent",
		source,
		ceiling: {
			capabilities: ["read" as const],
			resources: [{ deviceId: source.deviceId, paths: ["/device/home/agents/a"] }],
		},
		tool: "files_read",
		arguments: {},
	};
	await first.tools.call(input, "card", new AbortController().signal);
	await second.tools.call(input, "card", new AbortController().signal);
	const firstScope = first.calls.find((entry) => entry[0] === "conversation")?.[1];
	const secondScope = second.calls.find((entry) => entry[0] === "conversation")?.[1];
	expect(firstScope).not.toBe(secondScope);
	expect(JSON.parse(firstScope as string)[2]).toBe("https://card-one.example");
	expect(JSON.parse(secondScope as string)[2]).toBe("https://card-two.example");
});

test("program conversation scope reuses a profile and creates a new session after accepted default profile changes", async () => {
	const { calls, rows, acceptedAgent, tools } = fixture();
	const input = {
		agent: "local-agent",
		source,
		ceiling: { capabilities: ["read" as const] },
		tool: "files_read",
		arguments: {},
	};
	await tools.call(input, "card", new AbortController().signal);
	await tools.call({ ...input, source: { ...source, invocationId: "run-18" } }, "card", new AbortController().signal);
	const originalScopes = calls.filter((entry) => entry[0] === "conversation").map((entry) => entry[1]);
	expect(originalScopes[0]).toBe(originalScopes[1]);
	expect(rows.get("program-session")).toMatchObject({ profile: "default" });

	acceptedAgent.defaultProfile = "other";
	await tools.call({ ...input, source: { ...source, invocationId: "run-19" } }, "card", new AbortController().signal);
	const scopes = calls.filter((entry) => entry[0] === "conversation").map((entry) => entry[1]);
	expect(scopes[2]).not.toBe(scopes[1]);
	expect(rows.get("program-session-2")).toMatchObject({
		id: "program-session-2",
		agent: "local-agent",
		profile: "other",
		mode: "persistent",
	});
});

test("an unselected resource ceiling leaves device grants to the executor instead of narrowing to the host", async () => {
	// A Bot fanning out to every device tool sends no `resources`; the run must keep the host's own
	// cwd rules *and* the devices plugin's full grant set (19 §7/§9), not a synthesized local-only scope.
	const { calls, tools } = fixture();
	const input = {
		agent: "local-agent",
		source,
		ceiling: { capabilities: ["read" as const, "write" as const] },
		tool: "files_read",
		arguments: { path: "notes/today.md" },
	};
	await tools.call(input, "card", new AbortController().signal);
	const resolved = calls[0]?.[1] as { resources?: unknown };
	expect(resolved.resources).toBeUndefined();
});

test("program tools reject missing shared resources, empty capabilities, and unconfigured bridge instances", async () => {
	const { calls, tools } = fixture();
	const input = {
		agent: "local-agent",
		source,
		ceiling: { capabilities: ["read" as const], resources: [{ deviceId: "different-device", paths: ["/"] }] },
		tool: "files_read",
		arguments: {},
	};
	await expect(tools.catalog(input, "card", new AbortController().signal)).rejects.toThrow(
		"No shared device resources",
	);
	await expect(
		tools.catalog(
			{ ...input, ceiling: { capabilities: [], resources: [{ deviceId: source.deviceId, paths: ["/"] }] } },
			"card",
			new AbortController().signal,
		),
	).rejects.toThrow("No shared tool capabilities");
	await expect(tools.catalog(input, "unknown", new AbortController().signal)).rejects.toThrow("not configured");
	expect(calls).toEqual([]);
});
