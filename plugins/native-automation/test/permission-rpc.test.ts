import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHelper } from "../../../scripts/yonder-helper-install.mjs";
import { permissionCommand, permissionKinds } from "../../../scripts/yonder-permission-rpc.mjs";

const mock = vi.hoisted(() => ({
	files: new Map<string, string>(),
	commands: [] as string[][],
	launchCount: 0,
	responses: [] as unknown[][],
	cancel: false,
}));
// Installation has its own real-filesystem contracts. Keep this RPC transport
// fixture isolated from the shared installer's production-root and lock checks.
vi.mock("../../../scripts/yonder-helper-install.mjs", () => ({
	installHelper: vi.fn(async () => ({ home: "/isolated-mock-helper", app: "/isolated-mock-helper/Yonder Helper.app" })),
}));
vi.mock("node:fs/promises", () => ({
	mkdir: vi.fn(async () => {}),
	cp: vi.fn(async () => {}),
	rename: vi.fn(async () => {}),
	rm: vi.fn(async () => {}),
	mkdtemp: vi.fn(async () => "/isolated-mock-rpc"),
	writeFile: vi.fn(async (path: string, content: string) => {
		mock.files.set(path, String(content));
	}),
	readFile: vi.fn(async (path: string, encoding?: string) => {
		const value = mock.files.get(path) ?? "";
		return encoding ? value : Buffer.from(value);
	}),
}));
vi.mock("node:fs", () => ({ writeFileSync: vi.fn((path: string, value: string) => mock.files.set(path, value)) }));
vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(() => ""),
	spawnSync: vi.fn(() => ({ status: 0, stderr: "CDHash=123456\n" })),
	spawn: vi.fn((_command: string, args: string[]) => {
		mock.commands.push(args);
		const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
		child.stderr = new EventEmitter();
		setTimeout(() => {
			const lines = mock.responses[mock.launchCount++] ?? [];
			mock.files.set("/isolated-mock-rpc/output.json", lines.map((line) => JSON.stringify(line)).join("\n"));
			mock.files.set("/isolated-mock-rpc/pid", "424242");
			if (mock.cancel) process.emit("SIGTERM");
			child.emit("close", 0);
		}, 1);
		return child;
	}),
}));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
if (!platform) throw new Error("Missing process.platform descriptor");
const argv = process.argv;
const exitCode = process.exitCode;
let output: string;
beforeEach(() => {
	Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
	vi.resetModules();
	vi.mocked(installHelper).mockClear();
	mock.files.clear();
	mock.commands = [];
	mock.launchCount = 0;
	mock.responses = [];
	mock.cancel = false;
	output = "";
	vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
		output += chunk;
		return true;
	}) as typeof process.stdout.write);
	vi.spyOn(process, "kill").mockImplementation(() => true);
	process.exitCode = undefined;
});
afterEach(() => {
	Object.defineProperty(process, "platform", platform);
	process.argv = argv;
	process.exitCode = exitCode;
	vi.restoreAllMocks();
});
async function rpc(args: object) {
	process.argv = [process.execPath, "scripts/yonder-permissions.mjs", "rpc"];
	vi.spyOn(process, "stdin", "get").mockReturnValue(
		Readable.from([Buffer.from(JSON.stringify(args))]) as typeof process.stdin,
	);
	await import("../../../scripts/yonder-permissions.mjs");
	return output.trim() ? JSON.parse(output) : undefined;
}

describe("pure RPC contract", () => {
	it.each(permissionKinds)("one legal kind: %s", (kind) => {
		expect(permissionCommand({ action: "permission-request", kind })).toEqual(["request", kind]);
	});
	it.each(["guide", "watch"])("%s default equals real 600 seconds", (action) => {
		expect(permissionCommand({ action: `permission-${action}`, kind: "camera" })).toEqual([
			action,
			"camera",
			"--timeout",
			"600",
		]);
	});
	it.each([0, -1, 601, Number.NaN, Infinity, "1"])("invalid timeout: %s", (timeout) => {
		expect(() => permissionCommand({ action: "permission-watch", kind: "camera", timeout })).toThrow("timeout");
	});
	it("does not expose batch, reset, grant or raw CLI names", () => {
		for (const action of ["request", "guide", "watch", "grant", "reset", "permission-all"])
			expect(() => permissionCommand({ action, kind: "camera" })).toThrow();
		for (const kind of ["all", ["camera", "microphone"], undefined])
			expect(() => permissionCommand({ action: "permission-request", kind })).toThrow("kind");
	});
	it("status stays RPC and never becomes a request", () => {
		expect(permissionCommand({ action: "status" })).toBeUndefined();
		expect(permissionCommand({ action: "permissions" })).toBeUndefined();
	});
});

describe("launcher with all I/O mocked, no Helper or OS actions", () => {
	it("checkout self-check selects only a scratch Helper and cleans it with the RPC scratch", async () => {
		process.argv = [process.execPath, "scripts/yonder-permissions.mjs", "self-check"];
		mock.responses = [[{ fixture: "self-check response" }]];
		await import("../../../scripts/yonder-permissions.mjs");
		expect(installHelper).toHaveBeenCalledWith(expect.any(String), "/isolated-mock-rpc/helper");
		const { rm } = await import("node:fs/promises");
		expect(rm).toHaveBeenCalledWith("/isolated-mock-rpc", { recursive: true, force: true });
	});
	it("request reuses the CLI and preserves requested, not granted", async () => {
		mock.responses = [[[{ state: "requested" }]]];
		expect(await rpc({ action: "permission-request", kind: "camera" })).toEqual([{ state: "requested" }]);
		expect(installHelper).toHaveBeenCalledWith(expect.any(String), undefined);
		expect(mock.commands[0]).toContain("request");
		expect(mock.commands[0]).toContain("camera");
		expect(mock.commands[0]).not.toContain("rpc");
	});
	it.each(["timeout", "closed", "granted"])(
		"guide returns one final %s value, not progress NDJSON",
		async (outcome) => {
			const final = {
				outcome,
				exitCode: outcome === "granted" ? 0 : 1,
				permission: { state: outcome === "granted" ? "granted" : "requested" },
			};
			mock.responses = [[{ geometry: {} }, [{ state: "requested" }], final]];
			expect(await rpc({ action: "permission-guide", kind: "camera", timeout: 0.1 })).toEqual(final);
			expect(mock.commands[0]).toContain("guide");
			expect(process.exitCode).toBeUndefined();
		},
	);
	it("watch relaunch reuses the shared deadline and returns only the final observation", async () => {
		mock.responses = [[{ outcome: "relaunch", exitCode: 0 }], [{ outcome: "granted", exitCode: 0 }]];
		expect(await rpc({ action: "permission-watch", kind: "screen-recording", timeout: 2 })).toEqual({
			outcome: "granted",
			exitCode: 0,
		});
		expect(mock.commands).toHaveLength(2);
		for (const args of mock.commands) {
			expect(args).toContain("watch");
			const timeout = Number(args[args.indexOf("--timeout") + 1]);
			expect(timeout).toBeGreaterThan(0);
			expect(timeout).toBeLessThanOrEqual(2);
		}
	});
	it("an explicit Helper error is not converted to a successful request", async () => {
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		mock.responses = [[{ error: "OS request failed" }]];
		expect(await rpc({ action: "permission-request", kind: "camera" })).toBeUndefined();
		expect(process.exitCode).toBe(1);
		expect(stderr).toHaveBeenCalledWith("OS request failed");
	});
	it("empty Helper output is an error, not a successful initiation", async () => {
		mock.responses = [[]];
		await expect(rpc({ action: "permission-request", kind: "camera" })).rejects.toThrow("without JSON");
	});
	it("invalid kind is rejected before install or launch", async () => {
		await expect(rpc({ action: "permission-request", kind: "all" })).rejects.toThrow("kind");
		expect(mock.commands).toHaveLength(0);
		expect(mock.files.size).toBe(0);
	});
	it("cancellation forwards to the owned Helper and cannot report a grant", async () => {
		mock.cancel = true;
		mock.responses = [[{ outcome: "granted", exitCode: 0 }]];
		expect(await rpc({ action: "permission-watch", kind: "camera" })).toBeUndefined();
		expect(process.kill).toHaveBeenCalledWith(424242, "SIGTERM");
		expect(process.exitCode).toBe(130);
		expect(mock.files.has("/isolated-mock-rpc/cancelled")).toBe(true);
	});
	it("status launches the RPC only, without any permission command", async () => {
		mock.responses = [[{ permissions: [] }]];
		expect(await rpc({ action: "status" })).toEqual({ permissions: [] });
		expect(mock.commands[0]).toContain("rpc");
		for (const command of ["request", "guide", "watch"]) expect(mock.commands[0]).not.toContain(command);
	});
});

describe("file RPC validation and dispatch, no real Helper", () => {
	it.each(["file-list", "file-export"])("%s stays original RPC, never permission request", async (action) => {
		mock.responses = [[{ path: "/ordinary/artifact", size: 3 }]];
		expect(await rpc({ action, path: "/ordinary/source", destination: "/ordinary/artifact" })).toEqual({
			path: "/ordinary/artifact",
			size: 3,
		});
		expect(mock.commands[0]).toContain("rpc");
		expect(mock.commands[0]).not.toContain("request");
	});
	it.each(["relative", "", "/tmp/../x", "/tmp/\0x", undefined])(
		"invalid file path %j fails before launch",
		async (path) => {
			await expect(rpc({ action: "file-list", path })).rejects.toThrow("absolute");
			expect(mock.commands).toHaveLength(0);
		},
	);
	it("export requires an absolute generated destination", async () => {
		await expect(rpc({ action: "file-export", path: "/ordinary/source", destination: "relative" })).rejects.toThrow(
			"absolute",
		);
		expect(mock.commands).toHaveLength(0);
	});
});

describe("location RPC contract, no native manager or coordinates", () => {
	it("request timeout diagnostic metadata survives launcher JSON unchanged", async () => {
		const response = {
			action: "location-request",
			ok: false,
			outcome: "timeout",
			authorization: "notDetermined",
			failure: {
				code: "LOCATION_TIMEOUT",
				message: "Location operation exceeded its deadline.",
				diagnostics: {
					firstAuthorizationCallbackMs: 125,
					activationRequested: true,
					didBecomeActiveReceived: false,
					isActive: false,
					lastStage: "waitingForActivation",
				},
			},
		};
		mock.responses = [[response]];
		expect(await rpc({ action: "location-request", timeout: 1 })).toEqual(response);
		expect(mock.launchCount).toBe(1);
		expect(process.exitCode).toBeUndefined();
	});
	it.each(["location-status", "location-request", "location-collect"])("%s stays the original RPC", async (action) => {
		const response = {
			action,
			ok: false,
			authorization: "notDetermined",
			failure: { code: "LOCATION_NOT_DETERMINED" },
		};
		mock.responses = [[response]];
		expect(await rpc({ action, timeout: 1 })).toEqual(response);
		expect(mock.commands[0]).toContain("rpc");
		expect(mock.commands[0]).not.toContain("request");
		expect(process.exitCode).toBeUndefined(); // domain failure is structured JSON, not lost as stderr.
	});
	it.each([0, -1, 61, Number.NaN, Infinity, "1", null, true])("rejects location timeout %s", async (timeout) => {
		await expect(rpc({ action: "location-collect", timeout })).rejects.toThrow("timeout");
		expect(installHelper).not.toHaveBeenCalled();
		expect(mock.commands).toHaveLength(0);
	});
	it.each(["kind", "latitude", "request", "owner"])("rejects extra field %s before install", async (field) => {
		await expect(rpc({ action: "location-status", [field]: true })).rejects.toThrow("only action");
		expect(installHelper).not.toHaveBeenCalled();
	});
	it.each(["guide", "watch"])("CLI location %s fails before scratch/install", async (command) => {
		process.argv = [process.execPath, "scripts/yonder-permissions.mjs", command, "location"];
		await expect(import("../../../scripts/yonder-permissions.mjs")).rejects.toThrow("not guide/watch");
		expect(installHelper).not.toHaveBeenCalled();
		expect(mock.files.size).toBe(0);
	});
	it("location permission request retains CLI compatibility but has no guide/watch", () => {
		expect(permissionCommand({ action: "permission-request", kind: "location" })).toEqual(["request", "location"]);
		for (const action of ["permission-guide", "permission-watch"])
			expect(() => permissionCommand({ action, kind: "location" })).toThrow("not guide/watch");
	});
});
