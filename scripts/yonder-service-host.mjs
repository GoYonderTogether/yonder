#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installHelper } from "./yonder-helper-install.mjs";

/** The launcher stays in the launchd job until Helper AND its Node subtree stop.
 * Isolated tests supply an app and command; the product entry point below never
 * accepts arbitrary command overrides from environment variables.
 */
export async function runServiceHost({
	app,
	program,
	args,
	environment,
	cwd,
	home,
	direct = false,
	onState = () => {},
}) {
	await mkdir(join(home, ".yonder/logs"), { recursive: true });
	// /tmp rather than TMPDIR: a launchd TMPDIR can exceed sockaddr_un's 104 bytes.
	const scratch = await mkdtemp("/tmp/yonder-service-");
	const socketPath = join(scratch, "lease"),
		config = join(scratch, "launch.json");
	const executable = direct ? app : join(app, "Contents/MacOS/YonderHelper");
	await writeFile(
		config,
		JSON.stringify({
			program,
			launcherPid: process.pid,
			arguments: args,
			environment,
			cwd,
			log: join(home, ".yonder/logs/harness.log"),
			lock: join(home, ".yonder/service-host.lock"),
		}),
		{ mode: 0o600 },
	);
	let lease,
		state,
		stopping = false,
		error,
		open,
		startup,
		shutdownTimer;
	let finishLease;
	let acknowledging = false;
	const memberAcks = new Set();
	let verification = 0;
	const native = async (command, value) => {
		// Cancellation can overlap verification of the next command. Never let
		// two native verifiers read a shared file overwritten by another state.
		const file = join(scratch, `${command}-${++verification}.json`);
		await writeFile(file, JSON.stringify(value), { mode: 0o600 });
		try {
			const child = spawn(executable, [command, file], { stdio: "inherit" });
			await new Promise((resolve, reject) => {
				child.once("error", reject);
				child.once("close", (code) => (code ? reject(new Error(`${command} failed (${code})`)) : resolve()));
			});
		} finally {
			await rm(file, { force: true });
		}
	};
	const ended = new Promise((resolve) => {
		finishLease = resolve;
	});
	const server = createServer((connection) => {
		if (lease) {
			connection.destroy();
			return;
		}
		lease = connection;
		clearTimeout(startup);
		if (stopping) connection.end();
		let buffer = "";
		connection.setEncoding("utf8");
		connection.on("data", (chunk) => {
			buffer += chunk;
			if (buffer.length > 1024 * 1024) {
				error = new Error("Service lease message exceeds limit");
				connection.destroy();
				return;
			}
			let end = buffer.indexOf("\n");
			while (end >= 0) {
				try {
					state = { ...state, ...JSON.parse(buffer.slice(0, end)) };
					onState(state);
					if (state.awaitingAnchorAck && !acknowledging && !stopping) {
						acknowledging = true;
						const pending = state;
						// Launcher independently verifies the native start time, PGID and
						// Helper -> anchor ancestry before acknowledging its registry.
						native("service-verify-anchor", pending)
							.then(() => {
								if (!stopping && !connection.destroyed)
									connection.write(`${JSON.stringify({ anchorAck: pending.anchor })}\n`);
							})
							.catch((cause) => {
								error = cause;
								connection.destroy();
							});
					}
					if (!state.registering) memberAcks.clear();
					if (state.registering && !stopping) {
						const pending = state;
						const key = `${pending.registering.pid}:${pending.registering.seconds}:${pending.registering.micros}:${pending.groupStage ?? "member"}`;
						if (!memberAcks.has(key)) {
							memberAcks.add(key);
							native("service-verify-member", pending)
								.then(() => {
									if (!stopping && !connection.destroyed)
										connection.write(
											`${JSON.stringify({ memberAck: pending.registering, groupStage: pending.groupStage })}\n`,
										);
								})
								.catch(() => {
									// A command can be cancelled/reaped during native verification.
									// Decline its ACK; never tear down unrelated service tasks.
								});
						}
					}
				} catch (cause) {
					error = cause;
					connection.destroy();
					return;
				}
				buffer = buffer.slice(end + 1);
				end = buffer.indexOf("\n");
			}
		});
		connection.on("error", (cause) => {
			error = cause;
		});
		connection.on("close", finishLease);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	const stop = () => {
		if (stopping) return;
		stopping = true;
		lease?.end();
		// FIN is cooperative: neither a missing lease nor open -W may keep the
		// foreground job stuck forever. This is a bounded failure, not proof
		// that a wedged LaunchServices application has exited.
		shutdownTimer = setTimeout(() => {
			error ??= new Error("Helper shutdown exceeded 12s; application exit is unconfirmed");
			lease?.destroy();
			open?.kill("SIGKILL");
		}, 12_000);
	};
	process.on("SIGTERM", stop);
	process.on("SIGINT", stop);
	try {
		open = spawn(
			direct ? executable : "/usr/bin/open",
			direct
				? ["service-host", socketPath, config]
				: ["-n", "-g", "-W", "-a", app, "--args", "service-host", socketPath, config],
			{ stdio: ["ignore", "inherit", "inherit"] },
		);
		const closed = new Promise((resolve) => {
			open.once("error", (cause) => {
				error = cause;
				resolve();
			});
			open.once("close", resolve);
		});
		// open -W doesn't report the app's exit code. The lease and child command
		// are authoritative; any exit lets launchd apply the existing KeepAlive.
		startup = setTimeout(() => {
			error = new Error("Helper did not acquire its service lease within 20s");
			stop();
			open.kill();
		}, 20_000);
		await Promise.race([closed, ended]);
		clearTimeout(startup);
		stop();
		if (lease) await ended;
		try {
			if (state?.members?.length) {
				// Emergency cleanup also handles a SIGKILLed Helper. It does no permission IO.
				await native("service-cleanup", state);
			}
		} catch (cause) {
			error ??= cause;
		}

		await closed;
		if (error) throw error;
		if (!state) throw new Error("Helper exited before starting Node (duplicate host or launch failure)");
		return state.exitCode ?? 1;
	} finally {
		clearTimeout(startup);
		clearTimeout(shutdownTimer);
		process.off("SIGTERM", stop);
		process.off("SIGINT", stop);
		lease?.destroy();
		server.close();
		await rm(scratch, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	try {
		if (process.platform !== "darwin") throw new Error("Yonder service host requires macOS");
		const args = process.argv.slice(2);
		if (args.length !== 2 || args[0] !== "--home") throw new Error("Usage: yonder-service-host --home <home>");
		const install = process.env.YONDER_INSTALL;
		if (!install) throw new Error("YONDER_INSTALL is required");
		const root = fileURLToPath(new URL("../", import.meta.url));
		const { app } = await installHelper(root);
		process.exitCode = await runServiceHost({
			app,
			program: process.execPath,
			args: [join(install, "current/packages/cli/dist/index.js"), "start", "--home", args[1], "--json"],
			environment: { ...process.env },
			cwd: process.cwd(),
			home: args[1],
			onState: (state) => {
				const path = join(args[1], ".yonder/service-host.json");
				const pending = `${path}.${process.pid}`;
				writeFileSync(pending, JSON.stringify({ launcherPid: process.pid, updatedAt: Date.now(), ...state }), {
					mode: 0o600,
				});
				renameSync(pending, path);
			},
		});
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
