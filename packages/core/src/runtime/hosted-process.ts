import { spawn } from "node:child_process";
import { closeSync, fstatSync, readSync } from "node:fs";
import type { Socket } from "node:net";
import { constants } from "node:os";
import { isAbsolute } from "node:path";
import type { LocalProcessSpawn } from "@earendil-works/pi-durable/env/node";

// The host supplies a one-shot private fd, never a user-configurable executable
// setting. A hosted process with a missing/broken capability must fail closed.
let commandHost: { helper: string; registration: string } | undefined;
let commandHostFailure: unknown;
function hostedCommand() {
	if (process.platform !== "darwin") return undefined;
	if (commandHost) return commandHost;
	if (commandHostFailure) throw commandHostFailure;
	if (!process.env.YONDER_SERVICE_REGISTRATION && !process.env.YONDER_SERVICE_COMMAND_FD) return undefined;
	let opened = false;
	try {
		if (process.env.YONDER_SERVICE_COMMAND_FD !== "4" || !fstatSync(4).isSocket())
			throw new Error(
				"Service command capability is missing or invalid: fd 4 must be the helper socket; start the service through the installed launcher so the helper supplies it",
			);
		opened = true;
		const buffer = Buffer.alloc(16384);
		let size = 0;
		while (size < buffer.length) {
			const count = readSync(4, buffer, size, buffer.length - size, null);
			if (!count) break;
			size += count;
		}
		if (size === buffer.length) throw new Error("Service command capability exceeds limit");
		const value = JSON.parse(buffer.subarray(0, size).toString());
		if (
			typeof value.helper !== "string" ||
			!isAbsolute(value.helper) ||
			value.registration !== process.env.YONDER_SERVICE_REGISTRATION
		)
			throw new Error("Service command capability does not match the host");
		commandHost = value;
		return commandHost;
	} catch (error) {
		commandHostFailure = error;
		throw error;
	} finally {
		if (opened) closeSync(4);
	}
}

// Bash and local ExecutionEnv share this one reader/cache of the one-shot fd4.
// The adapter keeps raw stdio; only lifecycle and the verified status are hosted.
export function hostedProcessSpawner(): LocalProcessSpawn | undefined {
	const host = hostedCommand();
	if (!host) return undefined;
	return ({ program, args, cwd, env, stdin }) => {
		const child = spawn(host.helper, ["service-command-anchor"], {
			cwd,
			detached: false,
			env: { ...env, YONDER_SERVICE_REGISTRATION: host.registration },
			stdio: [stdin, "pipe", "pipe", "pipe"],
		});
		const control = child.stdio[3] as Socket;
		let outcome: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		let protocol = "";
		let fault: unknown;
		let cancelled = false;
		const cancel = () => {
			if (cancelled) return;
			cancelled = true;
			control.end();
		};
		const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
			control.setEncoding("utf8");
			control.on("data", (chunk: string) => {
				try {
					protocol += chunk;
					if (protocol.length > 16384) throw new Error("Command result exceeds limit");
					let end = protocol.indexOf("\n");
					while (end >= 0) {
						const frame = JSON.parse(protocol.slice(0, end));
						protocol = protocol.slice(end + 1);
						if ("exitCode" in frame) {
							const signal =
								frame.signal === null
									? null
									: (Object.entries(constants.signals).find(([, value]) => value === frame.signal)?.[0] as
											| NodeJS.Signals
											| undefined);
							if (
								outcome ||
								!(frame.exitCode === null || Number.isInteger(frame.exitCode)) ||
								signal === undefined ||
								(frame.exitCode === null) === (signal === null)
							)
								throw new Error("Invalid command result");
							outcome = { code: frame.exitCode, signal };
						}
						end = protocol.indexOf("\n");
					}
				} catch (error) {
					fault = error;
					cancel();
				}
			});
			control.on("error", (error) => {
				fault = error;
				cancel();
			});
			child.once("error", (error) => {
				fault = error;
			});
			child.once("close", (code, signal) => {
				if (fault) reject(fault);
				else if (!outcome || protocol)
					reject(new Error(`Hosted command exited without a verified result (${code}, ${signal})`));
				else resolve(outcome);
			});
			// Configuration is private control data, not argv shell interpolation.
			control.write(`${JSON.stringify({ launch: { program, arguments: args, environment: env } })}\n`);
		});
		return { child, cancel, result };
	};
}
