import { type ChildProcess, execFile, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const powerSocket = "/var/run/dev.yonder.harness.power.sock";
const file = (home: string) => join(home, ".yonder/awake.json");
export type AwakeMode = "off" | "tasks" | "always";
export const awakeGraceMs = 15 * 60 * 1000;
export async function awakeMode(home: string): Promise<AwakeMode> {
	try {
		const config = JSON.parse(await readFile(file(home), "utf8"));
		if (config.mode === "off" || config.mode === "tasks" || config.mode === "always") return config.mode;
		if (config.mode !== undefined) throw new Error("Invalid awake mode");
		return config.enabled === true ? "tasks" : "off";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "off";
		throw error;
	}
}
export async function awakeEnabled(home: string) {
	return (await awakeMode(home)) !== "off";
}
export async function setAwake(home: string, value: boolean | AwakeMode) {
	if (process.platform !== "darwin") throw new Error("Task awake is only supported on macOS");
	const mode = typeof value === "boolean" ? (value ? "tasks" : "off") : value;
	await mkdir(join(home, ".yonder"), { recursive: true });
	const temporary = `${file(home)}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ enabled: mode !== "off", mode })}\n`, { mode: 0o600 });
	await rename(temporary, file(home));
	return { enabled: mode !== "off", mode };
}

/** One service owns its grace period. Native execution remains the task authority. */
export function createAwakeHold() {
	let previousMode: AwakeMode = "off",
		wasActive = false,
		holdUntil: number | undefined;
	return (mode: AwakeMode, active: number, now: number) => {
		if (mode !== previousMode) {
			wasActive = false;
			holdUntil = undefined;
			previousMode = mode;
		}
		if (mode === "tasks") {
			if (active > 0) holdUntil = undefined;
			else if (wasActive) holdUntil = now + awakeGraceMs;
			wasActive = active > 0;
		}
		const grace = mode === "tasks" && active === 0 && holdUntil !== undefined && now <= holdUntil;
		const holding = mode === "always" || (mode === "tasks" && (active > 0 || grace));
		return {
			holding,
			holdUntil: grace ? holdUntil : undefined,
			reason: mode === "off" ? "off" : mode === "always" ? "always" : active > 0 ? "tasks" : grace ? "grace" : "idle",
		};
	};
}
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export async function installPower() {
	if (process.platform !== "darwin" || !process.getuid?.()) throw new Error("Run as the macOS desktop user");
	const source = fileURLToPath(
		new URL("../../macos/dist/YonderStatus.app/Contents/Resources/YonderPower", import.meta.url),
	);
	await lstat(source);
	const directory = await mkdtemp(join(tmpdir(), "yonder-power-install-"));
	const binary = "/Library/PrivilegedHelperTools/dev.yonder.harness.power";
	const plist = "/Library/LaunchDaemons/dev.yonder.harness.power.plist";
	const label = "dev.yonder.harness.power";
	const contents = `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${binary}</string><string>--serve</string><string>${process.getuid()}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>3</integer></dict></plist>`;
	await writeFile(join(directory, "power.plist"), contents, { mode: 0o600 });
	await writeFile(
		join(directory, "install.sh"),
		`#!/bin/sh\nset -eu\n/usr/bin/install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools\n/bin/launchctl bootout system/${label} 2>/dev/null || true\n/usr/bin/install -o root -g wheel -m 755 ${quote(source)} ${binary}\n/usr/bin/install -o root -g wheel -m 644 ${quote(join(directory, "power.plist"))} ${plist}\n/bin/launchctl bootstrap system ${plist}\n`,
		{ mode: 0o700 },
	);
	// The system owns authentication. No password enters this process or its logs.
	const command = `/bin/sh ${quote(join(directory, "install.sh"))}`;
	await promisify(execFile)("/usr/bin/osascript", [
		"-e",
		`do shell script ${JSON.stringify(command)} with administrator privileges`,
	]);
	return { installed: true };
}

/** A lease belongs to the service socket, never to menu/window visibility. */
export function startAwake(home: string, activity: () => Promise<{ active: number }>) {
	let socket: Socket | undefined,
		idle: ChildProcess | undefined,
		busy = false,
		closed = false;
	let snapshot: Record<string, unknown> = { enabled: false, active: 0, protected: false };
	let lastReply = 0;
	const hold = createAwakeHold();
	const disconnect = () => {
		socket?.destroy();
		socket = undefined;
	};
	async function tick() {
		if (busy || closed) return;
		busy = true;
		try {
			const mode = await awakeMode(home);
			const enabled = mode !== "off";
			const { active } = enabled ? await activity() : { active: 0 };
			if (closed) return;
			const policy = hold(mode, active, performance.now());
			const holdUntil =
				policy.holdUntil === undefined ? undefined : Date.now() + Math.max(0, policy.holdUntil - performance.now());
			const leaseActive = policy.holding ? Math.max(1, active) : 0;
			snapshot = { ...snapshot, enabled, mode, active, ...policy, holdUntil };
			if (!enabled || process.platform !== "darwin") {
				disconnect();
				idle?.kill();
				idle = undefined;
				snapshot = { enabled, mode, active: 0, protected: false, ...policy };
				return;
			}
			if (policy.holding && !idle) {
				const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
				idle = child;
				child.on("error", () => {
					if (idle === child) idle = undefined;
				});
				child.on("exit", () => {
					if (idle === child) idle = undefined;
				});
			} else if (!policy.holding) {
				idle?.kill();
				idle = undefined;
			}
			if (!socket) {
				const info = await lstat(powerSocket);
				if (closed) return;
				if (!info.isSocket() || info.uid !== 0) throw new Error("电源宿主身份无效");
				const connection = createConnection(powerSocket);
				socket = connection;
				let pending = "";
				connection.on("data", (data) => {
					pending += data;
					if (pending.length > 4096) {
						connection.destroy();
						return;
					}
					while (pending.includes("\n")) {
						const end = pending.indexOf("\n");
						try {
							const reply = JSON.parse(pending.slice(0, end));
							if (reply.protocol !== 2) {
								snapshot = { ...snapshot, requiresUpdate: true, protected: false, error: "电源组件需要更新" };
							} else {
								lastReply = Date.now();
								snapshot = {
									...snapshot,
									error: undefined,
									...reply,
									systemActive: reply.active,
									active: snapshot.active,
									requiresUpdate: false,
									protected: reply.protected === true && snapshot.holding === true,
								};
							}
						} catch {
							connection.destroy();
						}
						pending = pending.slice(end + 1);
					}
				});
				connection.on("error", (error) => {
					snapshot = { ...snapshot, protected: false, error: error.message };
				});
				connection.on("close", () => {
					if (socket === connection) {
						socket = undefined;
						snapshot = { ...snapshot, protected: false };
					}
				});
			}
			if (socket.writable) socket.write(`${JSON.stringify({ active: snapshot.requiresUpdate ? 0 : leaseActive })}\n`);
			if (Date.now() - lastReply > 5000) snapshot = { ...snapshot, protected: false, error: "等待电源宿主确认" };
		} catch (error) {
			disconnect();
			idle?.kill();
			idle = undefined;
			snapshot = { ...snapshot, protected: false, error: String(error) };
		} finally {
			busy = false;
		}
	}
	const timer = setInterval(() => void tick(), 1000);
	timer.unref();
	void tick();
	return {
		status: () => snapshot,
		async refresh() {
			await tick();
			return snapshot;
		},
		close() {
			closed = true;
			clearInterval(timer);
			disconnect();
			idle?.kill();
		},
	};
}
