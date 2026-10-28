import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, { daemonAbsent, imageMime } from "../src/index.js";
import { command, validate } from "../src/operations.js";
import { BskError, createBskRunner, parseBskJson } from "../src/runner.js";
import { BrowserSerial, BrowserSessions, waitForCleanup } from "../src/sessions.js";

const root = fileURLToPath(new URL("../", import.meta.url));
describe("browser-skill SDK contract and input boundaries", () => {
	it("matches packaged contributions without setup IO", async () => {
		expect(await checkPlugin(root)).toEqual([]);
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({ ...api, paths: { data: "/nonexistent-browser-skill-state" } } as PluginAPI);
		expect(registrations.tools).toHaveLength(9);
		expect(registrations.triggers).toHaveLength(1);
		expect(registrations.listeners.map((v) => v.type)).toEqual(["session.close"]);
	});
	it("does not interpret model text as shell/option syntax", () => {
		const value = "--json; $(touch /tmp/not-executed)\n'quoted'";
		const args = validate("interact", { action: "fill", target: "--bad-selector", value });
		expect(command("interact", args, "own")).toEqual([
			"fill",
			"--session",
			"own",
			`--value=${value}`,
			"--selector=--bad-selector",
		]);
		expect(command("page", validate("page", { action: "navigate", url: "--strange-url" }), "own")).toEqual([
			"navigate",
			"--session",
			"own",
			"--",
			"--strange-url",
		]);
	});
	it("rejects invalid action-dependent inputs without issuing a command", () => {
		for (const args of [
			{ action: "fill", target: "@e1" },
			{ action: "click", target: "@e1", captureId: "capture" },
			{ action: "wheel", deltaY: 0 },
			{ action: "wheel", deltaX: Number.NaN },
			{ action: "resize", width: 10, height: 200 },
			{ action: "select", target: "@e1", values: [] },
			{ action: "select", target: "@e1", values: [" "] },
			{ action: "click", target: " " },
			{ action: "press", key: "Enter", holdMs: Number.MAX_SAFE_INTEGER + 1 },
			{ action: "emulate", mobile: true },
			{ action: "emulate", off: true, width: 200, height: 200 },
			{ action: "click", target: "@e1", command: "bash" },
		])
			expect(() => validate("interact", args)).toThrow();
		expect(validate("interact", { action: "fill", target: "@e1", value: "" }).value).toBe("");
		expect(() => validate("session", { action: "stop", session: "x", requestId: "r" })).toThrow();
		expect(() => validate("inspect", { action: "screenshot", ref: "@e1", fullPage: true })).toThrow();
		expect(() => validate("page", { action: "wait-for-element", target: "@e1", pollMs: 15 })).toThrow();
	});
	it("preserves native error hints/data and does not turn a timeout condition into success", () => {
		const result = {
			code: 1,
			stdout: JSON.stringify({
				code: "operation_failed",
				message: "input uncertain",
				hint: "observe first",
				data: { effect_state: "unknown" },
			}),
			stderr: "",
			timedOut: false,
			aborted: false,
		};
		try {
			parseBskJson(result, "fill");
			throw new Error("must fail");
		} catch (error) {
			expect(error).toBeInstanceOf(BskError);
			expect((error as BskError).message).toContain("observe first");
			expect((error as BskError).data).toEqual({ effect_state: "unknown" });
		}
		expect(parseBskJson({ ...result, code: 0, stdout: '{"satisfied":false}' }, "wait-for-element")).toEqual({
			satisfied: false,
		});
		expect(() => parseBskJson({ ...result, code: 0, stdout: "" }, "observe")).toThrow("did not produce JSON");
		expect(() => parseBskJson({ ...result, aborted: true }, "fill")).toThrow("effect may already have occurred");
	});
	it("classifies only native confirmed absence, not an arbitrary failing daemon", () => {
		expect(daemonAbsent(new BskError("automatic daemon startup is disabled (BSK_AUTO_START=0)", { exitCode: 2 }))).toBe(
			true,
		);
		expect(daemonAbsent(new BskError("permission denied", { exitCode: 2 }))).toBe(false);
		expect(daemonAbsent(new BskError("IPC timeout", { timedOut: true }))).toBe(false);
	});
	it("sniffs actual image bytes instead of trusting a file suffix", () => {
		expect(imageMime(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
		expect(imageMime(Buffer.from([255, 216, 255]))).toBe("image/jpeg");
		expect(() => imageMime(Buffer.from("not an image"))).toThrow();
	});
	it("rejects a remote execution environment before any local state/CLI access", async () => {
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({ ...api, paths: { data: "/nonexistent-browser-skill-state" } } as PluginAPI);
		const result = await registrations.tools[0]?.execute({ action: "status" }, {
			env: { id: "ssh:remote" },
			signal: new AbortController().signal,
		} as ToolContext);
		expect(result?.isError).toBe(true);
		expect(result?.text).toContain("refusing host IO");
	});
});

describe("ownership and cancellation (no browser/model simulations)", () => {
	it("only resolves the native request owned by this Yonder conversation", async () => {
		const directory = await mkdtemp(join(tmpdir(), "yonder-bsk-owner-test-"));
		try {
			const requestId = `1000000000000:00000000-0000-0000-0000-000000000001`;
			await writeFile(
				join(directory, "requests.json"),
				JSON.stringify([{ requestId, owner: "alice", session: "abcd", browser: "instance" }]),
			);
			const state = new BrowserSessions(directory, createBskRunner("bsk"));
			expect(state.list("bob")).toEqual([]);
			expect(() => state.resolve("bob", "abcd", undefined, true)).toThrow("foreign");
			expect(() => state.resolve("alice", "abcd")).toThrow("not active");
			expect(state.resolve("alice", undefined, requestId, true).requestId).toBe(requestId);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("queued cancellation never dispatches and never lets a later action overlap", async () => {
		const serial = new BrowserSerial();
		const controller = new AbortController();
		let release: (() => void) | undefined;
		let later = false;
		const first = serial.run(
			"native-request",
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		await Promise.resolve();
		await Promise.resolve();
		const cancelled = serial.run(
			"native-request",
			async () => {
				throw new Error("must not dispatch");
			},
			controller.signal,
		);
		controller.abort();
		await expect(cancelled).rejects.toThrow("aborted");
		const third = serial.run("native-request", async () => {
			later = true;
		});
		expect(later).toBe(false);
		release?.();
		await first;
		await third;
		expect(later).toBe(true);
	});
	it("cancels the stop waiter without cancelling already accepted cleanup", async () => {
		let complete: ((value: string) => void) | undefined;
		const cleanup = new Promise<string>((resolve) => {
			complete = resolve;
		});
		const controller = new AbortController();
		const waiter = waitForCleanup(cleanup, controller.signal);
		controller.abort();
		await expect(waiter).rejects.toThrow("cleanup continues");
		complete?.("native completion");
		await expect(cleanup).resolves.toBe("native completion");
	});
	it("does not spawn a command with an already aborted signal", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await createBskRunner("/path/that/does/not/exist").run(["status"], { signal: controller.signal });
		expect(result.aborted).toBe(true);
		expect(result.code).toBeNull();
	});
});

describe("optional bookmarks", () => {
	it("builds literal argv and rejects unrelated fields", () => {
		expect(
			command(
				"bookmarks",
				validate("bookmarks", { action: "create-folder", parentId: "2", title: "--help", index: 0 }),
				"owned",
			),
		).toEqual(["bookmarks", "--session", "owned", "create-folder", "--parent=2", "--index=0", "--", "--help"]);
		expect(
			command("bookmarks", validate("bookmarks", { action: "move", parentId: "2", nodeId: "--help" }), "owned"),
		).toEqual(["bookmarks", "--session", "owned", "move", "--parent=2", "--", "--help"]);
		for (const args of [
			{ action: "tree", browser: "foreign" },
			{ action: "move", nodeId: "1", parentId: "2", index: -1 },
			{ action: "remove-empty-folder", nodeId: "1", recursive: true },
			{ action: "create-folder", parentId: "2", title: "x", url: "https://example.com" },
		])
			expect(() => validate("bookmarks", args)).toThrow();
	});
	it("is registered but disabled by default before any state or CLI IO", async () => {
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({
			...api,
			paths: { data: "/nonexistent-bookmark-state" },
			config: { bskPath: "/nonexistent-bsk" },
		} as PluginAPI);
		const tool = registrations.tools.find((t) => t.name === "browser-skill_bookmarks");
		if (!tool) throw new Error("Missing bookmark tool");
		const result = await tool.execute({ action: "tree" }, {
			session: "owner",
			env: { id: "node:local" },
			signal: new AbortController().signal,
		} as ToolContext);
		expect(result.isError).toBe(true);
		expect(result.text).toContain(process.platform === "darwin" ? "disabled" : "supports only the macOS");
	});
	it("rejects foreign and remote calls without touching a browser", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yonder-bookmarks-denied-"));
		try {
			await writeFile(
				join(dir, "requests.json"),
				JSON.stringify([
					{ requestId: "1000000000000:00000000-0000-0000-0000-000000000001", owner: "alice", session: "abcd" },
				]),
			);
			const { api, registrations } = createRegistrationCollector();
			plugin.setup({
				...api,
				paths: { data: dir },
				config: { bookmarksEnabled: true, bskPath: "/nonexistent-bsk" },
			} as PluginAPI);
			const tool = registrations.tools.find((t) => t.name === "browser-skill_bookmarks");
			if (!tool) throw new Error("Missing bookmark tool");
			for (const [owner, env, error] of [
				["bob", "node:local", "foreign"],
				["alice", "remote", "remote environment"],
			]) {
				const result = await tool.execute({ action: "tree", session: "abcd" }, {
					session: owner,
					env: { id: env },
					signal: new AbortController().signal,
				} as ToolContext);
				expect(result.isError).toBe(true);
				expect(result.text).toContain(process.platform === "darwin" ? error : "supports only the macOS");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("extension management boundaries", () => {
	it("maps only known actions and literal extension IDs", () => {
		const id = "a".repeat(32);
		expect(command("extensions", validate("extensions", { action: "disable", extensionId: id }), "own")).toEqual([
			"extensions",
			"--session",
			"own",
			"disable",
			id,
		]);
		for (const args of [
			{ action: "install" },
			{ action: "disable", extensionId: "--help" },
			{ action: "uninstall" },
			{ action: "list", extensionId: id },
		])
			expect(() => validate("extensions", args)).toThrow();
	});
	it("refuses management before CLI access unless the owner opts in", async () => {
		const { api, registrations } = createRegistrationCollector();
		plugin.setup({ ...api, paths: { data: "/nonexistent-browser-skill-state" } } as PluginAPI);
		const tool = registrations.tools.find((t) => t.name === "browser-skill_extensions");
		if (!tool) throw new Error("Missing extension tool");
		const result = await tool.execute({ action: "list" }, {
			env: { id: "node:local" },
			signal: new AbortController().signal,
		} as ToolContext);
		expect(result.isError).toBe(true);
		expect(result.text).toContain(process.platform === "darwin" ? "extensionsEnabled" : "supports only the macOS");
	});
});

it("preserves upstream UTF-8 streaming behavior for Chinese and emoji", async () => {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null,
		signalCode: null,
		unref() {},
	});
	const runner = createBskRunner("bsk", () => child as unknown as ChildProcess);
	const pending = runner.run(["snapshot"]);
	const stdout = JSON.stringify({ text: "中文🙂" });
	const stderr = "错误🚫";
	for (const byte of Buffer.from(stdout)) child.stdout.write(Buffer.from([byte]));
	for (const byte of Buffer.from(stderr)) child.stderr.write(Buffer.from([byte]));
	child.emit("close", 0);
	expect(await pending).toMatchObject({ stdout, stderr, code: 0 });
});
