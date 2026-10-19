import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { Check } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import { AppServer, DeadlineError } from "./app-server.js";
import { toolResult } from "./computer-use.js";
import plugin from "./index.js";
import { searchConfig, searchResult } from "./search.js";

describe("codex-tools source contract", () => {
	it("matches the built manifest and setup only registers", async () => {
		expect(await checkPlugin(resolve("plugins/codex-tools"))).toEqual([]);
	});
	it("declares static capabilities and rejects invalid parameters", () => {
		const { api, registrations } = createRegistrationCollector();
		plugin.setup(api as PluginAPI);
		expect(registrations.tools).toHaveLength(4);
		for (const tool of registrations.tools) expect(tool.capabilities).toContain("exec");
		const js = registrations.tools.find((tool) => tool.name === "codex-tools_js");
		if (!js) throw new Error("JS tool missing");
		expect(js.description).toContain("run.end releases all bindings");
		expect(Check(js.parameters, { code: "await cua.getState();" })).toBe(true);
		expect(Check(js.parameters, { code: "", timeout_ms: 0 })).toBe(false);
		expect(Check(js.parameters, { code: "", server: "other" })).toBe(false);
	});
	it("preserves actual-protocol empty/error blocks without fake success", () => {
		// Structural mapping only, not a model or desktop execution fixture.
		expect(toolResult({ content: [], isError: true }).isError).toBe(true);
		expect(() => toolResult({})).toThrow("content");
		expect(() => toolResult({ content: [{ type: "image" }] })).toThrow("mimeType/data");
	});
	it("maps MCP image fields to SDK images without embedding bytes in text", () => {
		// Pure field mapping, not a simulated screenshot/model execution.
		const result = toolResult({ content: [{ type: "image", mimeType: "image/png", data: "AA==" }] });
		expect(result.images).toEqual([{ mime: "image/png", data: "AA==" }]);
		expect(result.text).not.toContain("AA==");
	});
	it("uses native per-server overrides without replacing transports", () => {
		const config = searchConfig(["workbench"]);
		expect(() => searchConfig(["server.with.dots"])).toThrow("Cannot safely disable");
		expect(config["mcp_servers.workbench.enabled"]).toBe(false);
		expect(config.mcp_servers).toBeUndefined();
		expect(config.web_search).toBe("live");
		expect(config["features.shell_tool"]).toBe(false);
	});
	it("does not accept a normal answer as native hosted search", () => {
		expect(() => searchResult("gpt-6-luna", "", "", "completed", [])).toThrow("missing native");
		expect(() => searchResult("gpt-6-luna", "", "", "failed", [])).toThrow("status failed");
	});
});

it("rejects non-search execution and unsupported source URLs as hosted search evidence", () => {
	// Pure evidence rejection: these malformed protocol fragments are never model output.
	expect(() => searchResult("gpt-6-luna", "thread", "turn", "completed", [{ type: "commandExecution" }])).toThrow(
		"non-search",
	);
	for (const url of ["file:///tmp/private", "javascript:alert(1)", "not a URL"])
		expect(() =>
			searchResult("gpt-6-luna", "thread", "turn", "completed", [
				{ type: "webSearch", results: [{ url }] },
				{ type: "agentMessage", text: "text without a source" },
			]),
		).toThrow("missing native");
});

it("cleans pending RPC requests on cancellation, deadline and write failure without spawning Codex", async () => {
	// Exercise the actual request implementation with an in-memory wire, not an app-server/model.
	const pending = new Map();
	const send = vi.fn();
	const client: AppServer = Object.assign(Object.create(AppServer.prototype), { sequence: 0, pending, send });
	const controller = new AbortController();
	const waiting = client.request("protocol/check", {}, controller.signal);
	expect(pending.size).toBe(1);
	controller.abort(new Error("cancel RPC"));
	await expect(waiting).rejects.toThrow("cancel RPC");
	expect(pending.size).toBe(0);
	await expect(client.request("protocol/check", {}, new AbortController().signal, 1)).rejects.toBeInstanceOf(
		DeadlineError,
	);
	expect(pending.size).toBe(0);
	send.mockImplementationOnce(() => {
		throw new Error("wire closed");
	});
	await expect(client.request("protocol/check", {}, new AbortController().signal)).rejects.toThrow("wire closed");
	expect(pending.size).toBe(0);
	const calls = send.mock.calls.length;
	await expect(client.request("protocol/check", {}, AbortSignal.abort(new Error("already cancelled")))).rejects.toThrow(
		"already cancelled",
	);
	expect(send).toHaveBeenCalledTimes(calls);
});

it("connection cleanup is idempotent and removes only its owned temporary directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-codex-cleanup-"));
	try {
		const cwd = join(root, "owned");
		await mkdir(cwd);
		await writeFile(join(root, "keep"), "keep");
		const kill = vi.fn();
		const client: AppServer = Object.assign(Object.create(AppServer.prototype), {
			cwd,
			pending: new Map(),
			listeners: new Set(),
			exited: Promise.resolve(),
			child: { stdin: { end: vi.fn() }, kill },
			lines: { close: vi.fn() },
		});
		const close = client.close();
		expect(client.close()).toBe(close);
		await close;
		expect(kill).toHaveBeenCalledTimes(1);
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		await expect(stat(cwd)).rejects.toThrow();
		expect(await readFile(join(root, "keep"), "utf8")).toBe("keep");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
