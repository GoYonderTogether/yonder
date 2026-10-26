import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, freemem, homedir, release, tmpdir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppInventory, DeviceDescriptor, DeviceSession, UiSnapshot } from "@yonder/execution-protocol";
import type { BackendAction, BackendProvider } from "../backend-provider.js";
import { executableExists, linuxApps } from "./linux-apps.js";
import { runProcess } from "./process.js";

const targetId = "linux:desktop";
const require = createRequire(import.meta.url);
const actions = ["open", "click", "type", "scroll", "back"] as const;
type Action = (typeof actions)[number] | "snapshot" | "screenshot" | "probe" | "probe-screen";

function localSession(): boolean {
	return (
		process.platform === "linux" &&
		/^:\d+(?:\.\d+)?$/.test(process.env.DISPLAY ?? "") &&
		/^unix:(?:path|abstract)=/.test(process.env.DBUS_SESSION_BUS_ADDRESS ?? "") &&
		process.env.XDG_SESSION_TYPE !== "wayland"
	);
}

async function driverEntry(): Promise<string | undefined> {
	try {
		const entry = await realpath(require.resolve("agent-device"));
		const pkg = JSON.parse(await readFile(join(dirname(dirname(dirname(entry))), "package.json"), "utf8"));
		return pkg.name === "agent-device" && pkg.version === "0.21.31" ? entry : undefined;
	} catch {
		return undefined;
	}
}

function validArgs(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key)) && Object.keys(value).length === keys.length;
}
const coordinate = (value: unknown) =>
	Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 100_000;
const validators = {
	open: (a: Record<string, unknown>) =>
		validArgs(a, ["appId"]) &&
		typeof a.appId === "string" &&
		/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,254}\.desktop$/.test(a.appId),
	click: (a: Record<string, unknown>) => validArgs(a, ["x", "y"]) && coordinate(a.x) && coordinate(a.y),
	type: (a: Record<string, unknown>) =>
		validArgs(a, ["text"]) &&
		typeof a.text === "string" &&
		a.text.length > 0 &&
		a.text.length <= 10_000 &&
		!a.text.includes("\0"),
	scroll: (a: Record<string, unknown>) =>
		validArgs(a, ["direction", "pixels"]) &&
		["up", "down", "left", "right"].includes(String(a.direction)) &&
		Number.isSafeInteger(a.pixels) &&
		(a.pixels as number) >= 1 &&
		(a.pixels as number) <= 10_000,
	back: (a: Record<string, unknown>) => validArgs(a, []),
};

/** Lives in the device executor process. The SDK child inherits this guest's X11 and D-Bus session. */
export function createLinuxGuestProvider(deviceId: string, role: "full" | "execution-only"): BackendProvider {
	async function sdk(action: Action, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
		if (!localSession()) throw new Error("UNSUPPORTED_OPERATION");
		const entry = await driverEntry();
		if (!entry) throw new Error("UNSUPPORTED_OPERATION");
		const stateDir = await mkdtemp(join(tmpdir(), "yonder-linux-driver-"));
		try {
			const env: NodeJS.ProcessEnv = {
				PATH: "/usr/local/bin:/usr/bin:/bin",
				HOME: stateDir,
				DISPLAY: process.env.DISPLAY,
				DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS,
				XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
				XDG_SESSION_TYPE: "x11",
				XAUTHORITY: process.env.XAUTHORITY ?? join(homedir(), ".Xauthority"),
				LANG: process.env.LANG,
			};
			const raw = await runProcess(
				process.execPath,
				[fileURLToPath(new URL("./agent-device-worker.js", import.meta.url))],
				{
					input: JSON.stringify({ action, args, entry, stateDir }),
					env,
					...(signal ? { signal } : {}),
					timeoutMs: 45_000,
				},
			);
			const result = JSON.parse(raw) as { ok: boolean; code?: string; result?: unknown };
			if (!result.ok)
				throw new Error(
					result.code === "TOOL_MISSING" || result.code === "UNSUPPORTED_PLATFORM"
						? "UNSUPPORTED_OPERATION"
						: "INTERNAL_ERROR",
				);
			return result.result;
		} finally {
			await rm(stateDir, { recursive: true, force: true });
		}
	}

	async function inventory(): Promise<AppInventory> {
		if (process.platform !== "linux")
			return {
				deviceId,
				targetId,
				observedAt: null,
				status: "unsupported",
				complete: false,
				items: [],
				reason: "This provider runs inside Linux only",
			};
		return linuxApps(deviceId, targetId);
	}

	function checked(session: DeviceSession) {
		if (session.deviceId !== deviceId || session.targetId !== targetId) throw new Error("WRONG_TARGET");
	}

	const registered = Object.fromEntries(
		actions.map((name) => [
			`computer.${name}`,
			{
				capabilities: ["exec", "write"] as const,
				mutatesDevice: true,
				validate: validators[name],
				async execute(args: Record<string, unknown>, context: { session: DeviceSession; signal: AbortSignal }) {
					checked(context.session);
					if (!validators[name](args)) throw new Error("INVALID_REQUEST");
					if (name === "open") {
						if (!localSession()) throw new Error("UNSUPPORTED_OPERATION");
						const listed = await inventory();
						if (!listed.items.some((item) => item.id === args.appId)) throw new Error("UNSUPPORTED_OPERATION");
						context.signal.throwIfAborted();
						await runProcess("/usr/bin/gtk-launch", [args.appId as string], {
							signal: context.signal,
							timeoutMs: 15_000,
							env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
						});
						return { launchRequested: args.appId };
					}
					await sdk(name, args, context.signal);
					return { performed: name };
				},
			} satisfies BackendAction,
		]),
	) as Record<string, BackendAction>;

	return {
		actions: registered,
		async apps(requested) {
			if (requested !== targetId) throw new Error("WRONG_TARGET");
			return inventory();
		},
		async snapshot(session): Promise<UiSnapshot> {
			checked(session);
			const result: UiSnapshot = {
				deviceId,
				deviceSessionId: session.deviceSessionId,
				targetId,
				observedAt: new Date().toISOString(),
				status: "unsupported",
			};
			try {
				const tree = (await sdk("snapshot")) as { nodes?: unknown[]; truncated?: boolean };
				if (Array.isArray(tree.nodes)) {
					const runningApplications = tree.nodes.flatMap((node) => {
						if (!node || typeof node !== "object") return [];
						const app = node as { appName?: unknown; pid?: unknown };
						return typeof app.appName === "string" && app.appName.length > 0
							? [{ name: app.appName, ...(Number.isSafeInteger(app.pid) ? { pid: app.pid } : {}) }]
							: [];
					});
					result.tree = {
						nodes: tree.nodes,
						truncated: tree.truncated === true,
						runningApplications: [...new Map(runningApplications.map((app) => [JSON.stringify(app), app])).values()],
						runningApplicationsComplete: false,
						runningApplicationsSource: "AT-SPI snapshot",
					};
					result.status = "available";
				}
			} catch {}
			try {
				const image = (await sdk("screenshot")) as UiSnapshot["screenshot"];
				if (image?.mime === "image/png") {
					result.screenshot = image;
					result.status = "available";
				}
			} catch {}
			if (result.status === "unsupported") result.reason = "Local display, AT-SPI or screenshot driver unavailable";
			return result;
		},
		async describe(): Promise<DeviceDescriptor> {
			const observedAt = new Date().toISOString();
			const entry = localSession() ? await driverEntry() : undefined;
			let input = false;
			if (entry && (await executableExists("xdotool")))
				try {
					await runProcess("xdotool", ["getdisplaygeometry"], {
						timeoutMs: 3_000,
						env: {
							PATH: "/usr/local/bin:/usr/bin:/bin",
							DISPLAY: process.env.DISPLAY,
							XAUTHORITY: process.env.XAUTHORITY ?? join(homedir(), ".Xauthority"),
						},
					});
					input = true;
				} catch {}
			let tree = false;
			if (entry)
				try {
					tree = ((await sdk("probe")) as { tree?: boolean }).tree === true;
				} catch {}
			let screen = false;
			if (entry)
				try {
					screen = ((await sdk("probe-screen")) as { screen?: boolean }).screen === true;
				} catch {}
			const apps = await inventory();
			return {
				schemaVersion: 1,
				deviceId,
				role,
				os: { name: process.platform === "linux" ? "Linux" : process.platform, version: release() },
				hostArch: process.arch,
				processArch: process.arch,
				runtimeVersion: process.version,
				targets: [{ id: targetId, name: "Local Linux desktop" }],
				capabilities: [
					{
						id: "computer.tree",
						version: "agent-device@0.21.31",
						scope: targetId,
						state: tree ? "available" : "unsupported",
					},
					{
						id: "computer.input",
						version: "agent-device@0.21.31",
						scope: targetId,
						state: input ? "available" : "unsupported",
					},
					{
						id: "computer.screenshot",
						version: "agent-device@0.21.31",
						scope: targetId,
						state: screen ? "available" : "unsupported",
					},
					{
						id: "computer.launch",
						version: "gtk-launch",
						scope: targetId,
						state: localSession() && (await executableExists("/usr/bin/gtk-launch")) ? "available" : "unsupported",
					},
				],
				resources: {
					observedAt,
					cpuCount: cpus().length,
					memoryTotalBytes: totalmem(),
					memoryAvailableBytes: freemem(),
				},
				apps: { observedAt: apps.observedAt, status: apps.status, complete: apps.complete },
				lastSeenAt: observedAt,
				health: tree && input && screen && (await executableExists("/usr/bin/gtk-launch")) ? "ready" : "degraded",
				routes: [],
				checkpointRestore: "unsupported",
			};
		},
	};
}
