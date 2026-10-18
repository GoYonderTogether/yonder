// Standalone launchd child: no SDK/core imports, survives the harness service restart.
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Request {
	instance: string;
	repository: string;
	releaseId: string;
	tag: string;
	version: string;
	url: string;
	install: string;
	home: string;
	result: string;
	path: string;
}
interface CommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}
async function execute(program: string, args: string[], request: Request, timeout: number): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, PATH: request.path, YONDER_INSTALL: request.install, YONDER_HOME: request.home },
		});
		let stdout = "",
			stderr = "",
			timedOut = false;
		let kill: ReturnType<typeof setTimeout> | undefined;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			kill = setTimeout(() => child.kill("SIGKILL"), 2000);
		}, timeout);
		child.stdout.on("data", (chunk) => {
			stdout = (stdout + String(chunk)).slice(-2_000_000);
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + String(chunk)).slice(-32_000);
		});
		child.once("error", reject);
		child.once("close", (code) => {
			clearTimeout(timer);
			clearTimeout(kill);
			resolve({ code, stdout, stderr, timedOut });
		});
	});
}
function json(result: CommandResult): Record<string, unknown> {
	if (result.code !== 0 || result.timedOut)
		throw new Error(`Command failed (${result.code}); timedOut=${result.timedOut}; ${result.stderr.slice(-2000)}`);
	const value: unknown = JSON.parse(result.stdout);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CLI did not return a JSON object");
	return value as Record<string, unknown>;
}
const requestPath = process.argv[2];
if (!requestPath) throw new Error("Missing private update job request");
const request = JSON.parse(await readFile(requestPath, "utf8")) as Request;
const base = {
	instance: request.instance,
	repository: request.repository,
	releaseId: request.releaseId,
	tag: request.tag,
	version: request.version,
	sourceUrl: request.url,
	startedAt: new Date().toISOString(),
};
let result: Record<string, unknown>;
const evidence: Record<string, unknown> = {};
try {
	const executable = join(request.install, "bin/yonder");
	const before = json(await execute(executable, ["version", "--home", request.home, "--json"], request, 30_000));
	evidence.before = before;
	const serviceBefore = json(await execute(executable, ["service", "status", "--json"], request, 30_000));
	evidence.serviceBefore = serviceBefore;
	if (
		before.install !== request.install ||
		serviceBefore.install !== request.install ||
		serviceBefore.home !== request.home ||
		serviceBefore.loaded !== true
	)
		throw new Error("Installed executable/service/home boundary does not match configured update target");
	const updateCommand = await execute(
		executable,
		[
			"update",
			"--repo",
			`https://github.com/${request.repository}.git`,
			"--to",
			request.tag,
			"--home",
			request.home,
			"--json",
		],
		request,
		15 * 60_000,
	);
	evidence.updateCommand = updateCommand;
	const update = json(updateCommand);
	evidence.update = update;
	const actual = json(await execute(executable, ["version", "--home", request.home, "--json"], request, 30_000));
	evidence.actual = actual;
	let service = json(await execute(executable, ["service", "status", "--json"], request, 30_000));
	evidence.service = service;
	const deadline = Date.now() + 30_000;
	while (service.loaded === true && !service.pid && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		service = json(await execute(executable, ["service", "status", "--json"], request, 5000));
		evidence.service = service;
	}
	const origin = actual.origin as Record<string, unknown> | null;
	const restarted = before.version === request.version || service.pid !== serviceBefore.pid;
	const verified =
		restarted &&
		actual.source === join(request.install, "versions", request.version) &&
		actual.version === request.version &&
		actual.install === request.install &&
		origin?.tag === request.tag &&
		origin?.repository === `https://github.com/${request.repository}.git` &&
		typeof origin.commit === "string" &&
		service.loaded === true &&
		typeof service.pid === "number" &&
		service.pid > 0 &&
		service.home === request.home &&
		service.install === request.install;
	result = {
		...base,
		status: verified ? "verified" : "verification-failed",
		before,
		serviceBefore,
		update,
		actual,
		service,
		verified,
	};
} catch (error) {
	// The existing updater owns rollback. Unknown/failed commands never claim a successful install.
	result = {
		...base,
		...evidence,
		status: "failed-or-unknown",
		verified: false,
		error: error instanceof Error ? error.message : String(error),
	};
}
await writeFile(`${request.result}.tmp`, JSON.stringify({ ...result, endedAt: new Date().toISOString() }), {
	mode: 0o600,
});
await rename(`${request.result}.tmp`, request.result);
