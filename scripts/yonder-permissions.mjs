#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { permissionCommand, permissionKinds } from "./yonder-permission-rpc.mjs";

const kinds = permissionKinds;
const args = process.argv.slice(2);
let timeout = 600;
if (args.length === 4 && ["guide", "watch"].includes(args[0]) && args[2] === "--timeout") {
	timeout = Number(args.pop());
	args.pop();
	if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600) {
		console.error("Invalid timeout (0 < seconds <= 600)");
		process.exit(2);
	}
}

if (
	!(
		(args.length === 1 && ["status", "permissions", "rpc", "self-check"].includes(args[0])) ||
		(args.length === 2 && ["request", "guide", "watch"].includes(args[0]) && kinds.includes(args[1]))
	)
) {
	console.error("Usage: yonder-permissions status | request|guide|watch <kind>");
	process.exit(2);
}
if (process.platform !== "darwin") throw new Error("Yonder Helper requires macOS");
let request = "{}";
let rpcPermission;
if (args[0] === "rpc") {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of process.stdin) {
		bytes += chunk.length;
		if (bytes > 100000) throw new Error("Helper request exceeds 100KB");
		chunks.push(chunk);
	}
	request = Buffer.concat(chunks).toString("utf8");
	rpcPermission = permissionCommand(JSON.parse(request));
	if (rpcPermission?.[2] === "--timeout") timeout = Number(rpcPermission[3]);
} else if (["status", "permissions", "self-check"].includes(args[0])) request = JSON.stringify({ action: args[0] });
const deadline = Date.now() + timeout * 1000;

const root = fileURLToPath(new URL("../", import.meta.url));
const home = join(homedir(), ".local/share/yonder-harness/helper");
const app = join(home, "Yonder Helper.app");
const source = join(root, "packages/macos-helper/dist/Yonder Helper.app");
// codesign writes inspection to stderr, including on success.
const codeHash = (path) => {
	const result = spawnSyncCode(path);
	return (
		result.match(/^CDHash=(\w+)$/mu)?.[1] ??
		(() => {
			throw new Error("Missing helper CDHash");
		})()
	);
};
function spawnSyncCode(path) {
	const result = spawnSync("/usr/bin/codesign", ["-d", "--verbose=4", path], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(`Helper missing or unsigned: run npm run build (${path})`);
	return result.stderr;
}
await mkdir(home, { recursive: true, mode: 0o700 });
const desired = codeHash(source);
let installed;
try {
	installed = codeHash(app);
} catch {}
if (installed !== desired) {
	const lock = join(home, "install.lock");
	await mkdir(lock); // Concurrent upgrade fails explicitly; never overwrite another install.
	try {
		const pending = join(home, `Yonder Helper.${process.pid}.app`);
		await cp(source, pending, { recursive: true });
		execFileSync("/usr/bin/codesign", ["--verify", "--strict", pending]);
		await rm(app, { recursive: true, force: true });
		await rename(pending, app);
	} finally {
		await rm(lock, { recursive: true });
	}
}
// Stable owner entry point follows the current release's launcher, state stays outside the app.
const wrapper = `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${fileURLToPath(import.meta.url).replaceAll("'", "'\\''")}' "$@"\n`;
const wrapperPath = join(home, "yonder-permissions");
let priorWrapper;
try {
	priorWrapper = await readFile(wrapperPath, "utf8");
} catch {}
if (priorWrapper !== wrapper) {
	const pendingWrapper = `${wrapperPath}.${process.pid}`;
	await writeFile(pendingWrapper, wrapper, { mode: 0o700 });
	await rename(pendingWrapper, wrapperPath);
}
const scratch = await mkdtemp(join(tmpdir(), "yonder-helper-rpc-"));
const input = join(scratch, "input.json"),
	output = join(scratch, "output.json"),
	errors = join(scratch, "stderr"),
	pidFile = join(scratch, "pid");
await Promise.all([
	writeFile(input, request, { mode: 0o600 }),
	writeFile(output, "", { mode: 0o600 }),
	writeFile(errors, "", { mode: 0o600 }),
]);
const command = rpcPermission ?? (["status", "permissions", "rpc", "self-check"].includes(args[0]) ? ["rpc"] : args);
try {
	while (true) {
		if (["guide", "watch"].includes(command[0])) {
			command.splice(2, command.length, "--timeout", String(Math.max(0.001, (deadline - Date.now()) / 1000)));
		}
		await Promise.all([writeFile(output, ""), writeFile(errors, ""), rm(pidFile, { force: true })]);
		const child = spawn(
			"/usr/bin/open",
			[
				"-n",
				"-g",
				"-W",
				"--stdin",
				input,
				"--stdout",
				output,
				"--stderr",
				errors,
				"-a",
				app,
				"--args",
				...command,
				"--pid-file",
				pidFile,
			],
			{ stdio: ["ignore", "ignore", "pipe"] },
		);
		let cancelled = false,
			offset = 0;
		const cancel = () => {
			cancelled = true;
			writeFileSync(join(scratch, "cancelled"), "", { mode: 0o600 });
		};
		process.on("SIGTERM", cancel);
		process.on("SIGINT", cancel);
		const poll = async () => {
			if (cancelled) {
				try {
					const pid = Number(await readFile(pidFile, "utf8"));
					if (Number.isInteger(pid) && pid > 1) process.kill(pid, "SIGTERM");
				} catch {}
			}
			const data = await readFile(output);
			if (data.length > offset) {
				if (!rpcPermission) process.stdout.write(data.subarray(offset));
				offset = data.length;
			}
		};
		let polling = Promise.resolve();
		const timer = setInterval(() => {
			polling = polling.then(poll);
		}, 100);
		let launchError = "";
		child.stderr.on("data", (data) => {
			launchError += data;
		});
		try {
			const code = await new Promise((resolve, reject) => {
				child.on("error", reject);
				child.on("close", resolve);
			});
			clearInterval(timer);
			await polling;
			await poll();
			if (code !== 0) throw new Error(`LaunchServices failed (${code}): ${launchError}`);
			const result = await readFile(output, "utf8");
			if (!result.trim() && (command[0] === "rpc" || rpcPermission))
				throw new Error(`Helper exited without JSON: ${await readFile(errors, "utf8")}`);
			const lines = result.split("\n").filter((line) => line.trim());
			for (const line of lines) {
				const message = JSON.parse(line).error;
				if (message) {
					console.error(message);
					process.exitCode = 1;
				}
			}
			const final = lines.length ? JSON.parse(lines.at(-1)) : undefined;
			if (cancelled) process.exitCode = 130;
			else if (final?.outcome === "relaunch" && Date.now() < deadline) continue;
			else if (rpcPermission && final && !process.exitCode) {
				// RPC returns one final JSON value, never the guide's progress NDJSON.
				// timeout/closed remain explicit outcomes, not transport failures or grants.
				process.stdout.write(`${JSON.stringify(final)}\n`);
			} else if (final?.exitCode !== undefined) process.exitCode = final.exitCode;
			else if (["guide", "watch"].includes(command[0])) process.exitCode = 1;
			break;
		} finally {
			clearInterval(timer);
			process.off("SIGTERM", cancel);
			process.off("SIGINT", cancel);
		}
	}
} finally {
	await rm(scratch, { recursive: true, force: true });
}
