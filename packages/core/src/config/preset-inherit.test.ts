import { expect, test } from "vitest";
import { describeCatalog } from "../runtime/catalog.js";
import { presetSession } from "./index.js";
import { presetProfile, resolveProfile } from "./test-support.js";

const opener = resolveProfile(
	{
		capabilities: ["read", "write", "exec", "network", "message"],
		plugins: ["web-tools", "cron", "browser-skill"],
		tools: { offer: ["read", "bash", "web-tools_*", "message_send"], search: ["mcp_*"] },
		skills: ["notes-*"],
	},
	{},
	"local",
);

test("a preset that sets no permissions takes the opener's, so it never exceeds or falls below it", () => {
	const session = presetSession({}, "local", opener);
	expect(session.capabilities).toEqual(["read", "write", "exec", "network", "message"]);
	expect(session.inherit).toEqual({
		plugins: ["web-tools", "cron", "browser-skill"],
		tools: { offer: ["read", "bash", "web-tools_*", "message_send"], search: ["mcp_*"] },
		skills: ["notes-*"],
		ceilings: [],
		explicitSessionTools: false,
	});
});

test("a read-only opener gives a read-only child", () => {
	const readonly = resolveProfile({ level: "readonly" }, {}, "local");
	expect(presetSession({}, "local", readonly).capabilities).toEqual(["read"]);
});

test("a preset that sets permissions is intersected with the opener and cannot raise them", () => {
	const narrower = presetSession({ capabilities: ["read", "network"] }, "local", opener);
	expect(narrower.capabilities).toEqual(["read", "network"]);
	const readonly = resolveProfile({ level: "readonly" }, {}, "local");
	expect(presetSession({ level: "bypass" }, "local", readonly).capabilities).toEqual(["read"]);
});

test("a plugin caller's limit bounds an inheriting preset, and a standalone preset without permissions stays read-only", () => {
	expect(presetSession({}, "local", opener, ["read", "network"]).capabilities).toEqual(["read", "network"]);
	expect(presetSession({}, "local", undefined, ["read", "exec"]).capabilities).toEqual(["read", "exec"]);
	expect(presetSession({}, "local").capabilities).toEqual(["read"]);
});

test("preset selection cannot expand the parent's plugins, tools or skills, including nested children", () => {
	const { inherit, capabilities } = presetSession({}, "local", opener);
	const child = presetProfile(
		{ plugins: ["web-tools", "agent-presets"], tools: { offer: ["*"], search: ["*"] }, skills: ["*"] },
		"local",
		capabilities,
		inherit,
	);
	expect(child.plugins).toEqual(["web-tools"]);
	expect(child.capabilities).toEqual(["read", "write", "exec", "network", "message"]);
	const nested = presetSession({}, "local", child);
	const grandchild = presetProfile(
		{ tools: { offer: ["*"], search: ["*"] }, skills: ["*"] },
		"local",
		nested.capabilities,
		nested.inherit,
	);
	const catalog = describeCatalog({ agent: null, profile: "child", cwd: "/tmp", resolved: grandchild }, [
		{ name: "read", capabilities: [] },
		{ name: "grep", capabilities: [] },
		{ name: "web-tools_search", capabilities: [], plugin: "web-tools" },
		{ name: "mcp_lookup", capabilities: [] },
		{ name: "other", capabilities: [] },
	]);
	expect(catalog.map(({ name, exposure }) => [name, exposure])).toEqual([
		["read", "offer"],
		["grep", "not-selected"],
		["web-tools_search", "offer"],
		["mcp_lookup", "search"],
		["other", "not-selected"],
	]);
	expect(
		grandchild.delegationCeilings?.every((ceiling) =>
			ceiling.skills.some((pattern) => pattern === "*" || pattern === "notes-*"),
		),
	).toBe(true);
});

test("resident parent session tools require exact selection in child and legacy snapshots deny unknown skills", () => {
	const resident = resolveProfile({ tools: { offer: ["*"] }, skills: ["*"] });
	const saved = presetSession({}, "local", resident, undefined, "other");
	const child = presetProfile({}, "local", saved.capabilities, saved.inherit);
	const catalog = describeCatalog({ agent: null, profile: "child", cwd: "/tmp", resolved: child }, [
		{ name: "session_list", capabilities: [] },
		{ name: "read", capabilities: [] },
	]);
	expect(catalog.map((tool) => tool.exposure)).toEqual(["not-selected", "offer"]);
	const legacy = presetProfile({ skills: ["*"] }, "local", saved.capabilities, {
		plugins: [],
		tools: { offer: ["*"], search: [] },
	});
	expect(legacy.delegationCeilings?.[0]?.skills).toEqual([]);
});
