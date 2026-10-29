import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { inspectToolCatalog } from "./catalog.js";

test("session tools default to main and require exact selection for other agents", () => {
	const config = { agent: "main", profile: "owner", cwd: process.cwd(), resolved: resolveProfile({ level: "bypass" }) };
	const exposure = (agent: string, offer: string[], search: string[] = []) =>
		inspectToolCatalog(
			{ ...config, agent, resolved: resolveProfile({ level: "bypass", tools: { offer, search } }) },
			new Map(),
		);
	for (const name of ["session_list", "session_read"]) {
		expect(exposure("main", ["*"]).find((tool) => tool.name === name)?.exposure).toBe("offer");
		expect(exposure("other", ["*"]).find((tool) => tool.name === name)?.exposure).toBe("not-selected");
		expect(exposure("other", ["session_*"]).find((tool) => tool.name === name)?.exposure).toBe("not-selected");
		expect(exposure("other", ["*", name]).find((tool) => tool.name === name)?.exposure).toBe("offer");
		expect(exposure("other", ["*"], [name]).find((tool) => tool.name === name)?.exposure).toBe("search");
	}
	expect(exposure("other", ["*"]).find((tool) => tool.name === "process")?.exposure).toBe("offer");
	expect(
		inspectToolCatalog(
			{
				...config,
				agent: "other",
				resolved: resolveProfile({ level: "readonly", tools: { offer: ["session_read"] } }),
			},
			new Map(),
		).find((tool) => tool.name === "session_read")?.exposure,
	).toBe("capability-denied");
});

test("only resident Agents can offer agent_ask even when a preset selects every tool", () => {
	const config = {
		agent: "main" as string | null,
		profile: "owner",
		cwd: process.cwd(),
		resolved: resolveProfile({ capabilities: ["message"], tools: { offer: ["*"] } }),
	};
	expect(inspectToolCatalog(config, new Map()).find((tool) => tool.name === "agent_ask")?.exposure).toBe("offer");
	expect(
		inspectToolCatalog({ ...config, agent: null }, new Map()).find((tool) => tool.name === "agent_ask")?.exposure,
	).toBe("not-selected");
});

test("an identity-less preset cannot expose agent_ask through tool search", () => {
	const config = {
		agent: null,
		profile: "default",
		cwd: process.cwd(),
		resolved: resolveProfile({ capabilities: ["message"], tools: { offer: [], search: ["agent_ask"] } }),
	};
	const tools = inspectToolCatalog(config, new Map());
	expect(tools.find((tool) => tool.name === "agent_ask")?.exposure).toBe("not-selected");
	expect(tools.find((tool) => tool.name === "tool_search")?.exposure).toBe("not-selected");
	const resident = inspectToolCatalog({ ...config, agent: "main" }, new Map());
	expect(resident.find((tool) => tool.name === "agent_ask")?.exposure).toBe("search");
	expect(resident.find((tool) => tool.name === "tool_search")?.exposure).toBe("offer");
});

test("shared permissions is discovered as a core tool through offer/search catalog selection", () => {
	const config = {
		agent: null,
		profile: "permissions",
		cwd: process.cwd(),
		resolved: resolveProfile({ plugins: [], capabilities: [], tools: { offer: [], search: ["permissions"] } }),
	};
	const catalog = inspectToolCatalog(config, new Map());
	expect(catalog.find((tool) => tool.name === "permissions")).toMatchObject({ exposure: "search", missing: [] });
	expect(catalog.find((tool) => tool.name === "tool_search")?.exposure).toBe("offer");
	const offered = inspectToolCatalog(
		{ ...config, resolved: resolveProfile({ tools: { offer: ["permissions"], search: [] } }) },
		new Map(),
	);
	expect(offered.find((tool) => tool.name === "permissions")?.exposure).toBe("offer");
});

test("plugin tools enter the catalog only when selected and authorized", () => {
	const tools = new Map([
		[
			"sample",
			[
				{
					name: "sample_read",
					description: "Read",
					parameters: {} as never,
					capabilities: ["read"],
					guidelines: ["Read guidance"],
					execute: async () => ({ content: [] }),
				} as never,
			],
		],
	]);
	const config = {
		agent: "main",
		profile: "owner",
		cwd: process.cwd(),
		resolved: resolveProfile({
			plugins: ["sample"],
			capabilities: ["read"],
			tools: { offer: ["sample_read"], search: [] },
		}),
	};
	const exposure = (resolved: typeof config.resolved) =>
		inspectToolCatalog({ ...config, resolved }, tools).find((item) => item.name === "sample_read")?.exposure;
	expect(exposure(config.resolved)).toBe("offer");
	expect(
		exposure(
			resolveProfile({ plugins: ["sample"], capabilities: ["read"], tools: { offer: [], search: ["sample_read"] } }),
		),
	).toBe("search");
	expect(exposure(resolveProfile({ plugins: [], capabilities: ["read"], tools: { offer: ["sample_read"] } }))).toBe(
		"plugin-not-selected",
	);
	expect(exposure(resolveProfile({ plugins: ["sample"], capabilities: [], tools: { offer: ["sample_read"] } }))).toBe(
		"capability-denied",
	);
});

test("find registration respects tool selection and read capability", () => {
	const config = { agent: "main", profile: "owner", cwd: process.cwd() };
	const exposure = (capabilities: string[], offer: string[], search: string[] = []) =>
		inspectToolCatalog(
			{ ...config, resolved: resolveProfile({ capabilities: capabilities as never, tools: { offer, search } }) },
			new Map(),
		).find((tool) => tool.name === "find");
	expect(exposure(["read"], ["find"])).toMatchObject({ exposure: "offer", missing: [] });
	expect(exposure(["read"], [], ["find"])?.exposure).toBe("search");
	expect(exposure(["read"], [])?.exposure).toBe("not-selected");
	expect(exposure([], ["find"])?.exposure).toBe("capability-denied");
});

test("anchor edit tools are offered and gated by the write capability", () => {
	const config = { agent: "main", profile: "owner", cwd: process.cwd() };
	const catalog = (capabilities: string[]) =>
		inspectToolCatalog(
			{
				...config,
				resolved: resolveProfile({ capabilities: capabilities as never, tools: { offer: ["*"], search: [] } }),
			},
			new Map(),
		);
	for (const name of ["replace", "replace_match"]) {
		expect(catalog(["read", "write"]).find((tool) => tool.name === name)).toMatchObject({
			exposure: "offer",
			capabilities: ["write"],
			missing: [],
		});
		expect(catalog(["read"]).find((tool) => tool.name === name)?.exposure).toBe("capability-denied");
	}
});
