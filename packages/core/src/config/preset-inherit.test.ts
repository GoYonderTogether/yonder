import { expect, test } from "vitest";
import { presetSession } from "./index.js";
import { presetProfile, resolveProfile } from "./test-support.js";

const opener = resolveProfile(
	{
		capabilities: ["read", "write", "exec", "network", "message"],
		plugins: ["web-tools", "cron", "browser-skill"],
		tools: { offer: ["read", "bash", "web-tools_*", "message_send"], search: ["mcp_*"] },
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

test("the child gets the opener's plugins and tools unless the preset sets its own", () => {
	const { inherit, capabilities } = presetSession({}, "local", opener);
	const child = presetProfile({ plugins: ["agent-presets"] }, "local", capabilities, inherit);
	expect(child.plugins).toEqual(["web-tools", "cron", "browser-skill", "agent-presets"]);
	expect(child.tools).toEqual({ offer: ["read", "bash", "web-tools_*", "message_send"], search: ["mcp_*"] });
	expect(child.capabilities).toEqual(["read", "write", "exec", "network", "message"]);
	const narrowed = presetProfile({ tools: { offer: ["read", "grep"] } }, "local", capabilities, inherit);
	expect(narrowed.tools).toEqual({ offer: ["read", "grep"], search: ["mcp_*"] });
});
