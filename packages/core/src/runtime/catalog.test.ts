import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { describeCatalog, inspectToolCatalog } from "./catalog.js";

test("login_begin remains write-gated when login operations are enabled", () => {
	const tool: Array<{ name: string; capabilities: ["write"] }> = [{ name: "login_begin", capabilities: ["write"] }];
	const readonly = {
		agent: "main",
		profile: "guest",
		cwd: process.cwd(),
		resolved: resolveProfile({ capabilities: ["read"], tools: { offer: ["*"] } }),
	};
	const owner = {
		...readonly,
		profile: "owner",
		resolved: resolveProfile({ capabilities: ["write"], tools: { offer: ["*"] } }),
	};
	expect(describeCatalog(readonly, tool)[0]?.exposure).toBe("capability-denied");
	expect(describeCatalog(owner, tool)[0]?.exposure).toBe("offer");
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
