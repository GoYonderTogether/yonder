import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { inspectToolCatalog } from "./catalog.js";

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
