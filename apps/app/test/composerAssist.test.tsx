import { afterEach, expect, test, vi } from "vitest";
import { inviteBot, parseSlash, runCommand, slashCommands } from "../src/work/ui/ComposerAssist";

const calls: { url: string; body: unknown }[] = [];
afterEach(() => {
	calls.length = 0;
	vi.unstubAllGlobals();
});
function fetchEcho(result: unknown) {
	vi.stubGlobal("location", new URL("http://127.0.0.1:7690/"));
	vi.stubGlobal("document", { querySelector: () => null });
	vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
	});
}

test("parseSlash maps Chinese commands to sessions.command text", () => {
	expect(parseSlash("/思考 high")).toBe("effort high");
	expect(parseSlash("/模型 a/b")).toBe("model a/b");
	expect(parseSlash("/状态")).toBe("status");
	expect(parseSlash("/压缩")).toBe("compact");
	expect(parseSlash("hello")).toBeNull();
	expect(parseSlash("/归档")).toBeNull();
});

test("slash menu lists model, effort, status and compact", () => {
	const labels = slashCommands("s1").map((c) => c.label);
	expect(labels).toEqual(expect.arrayContaining(["/模型", "/思考", "/状态", "/压缩", "/邀请", "/归档"]));
});

test("runCommand and inviteBot send the expected RPC shapes", async () => {
	fetchEcho("ok");
	await runCommand("s1", "effort high");
	await inviteBot("s1", "bot-a", "小助");
	const text = JSON.stringify(calls);
	expect(text).toContain("sessions.command");
	expect(text).toContain('"command":"effort high"');
	expect(text).toContain("sessions.submit");
	expect(text).toContain("bot_attach");
	expect(text).toContain("bot-a");
});
