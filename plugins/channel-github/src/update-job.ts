// Standalone launchd child: no SDK/core imports, survives the harness service restart.
import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface Request {
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
	/** Automatic updates wait for running work to finish (bounded); an explicitly requested update does not. */
	defer?: boolean;
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
		child.once("error", (error) => {
			clearTimeout(timer);
			clearTimeout(kill);
			reject(error);
		});
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

/** GitHub redirects a renamed repository forever; a receipt written before the rename still describes this repository. */
const RENAMED_REPOSITORIES: Record<string, string[]> = {
	"yonder-harness": ["yonder"],
	yonder: ["yonder-harness"],
};

function originMatches(origin: Record<string, unknown> | null, repository: string): boolean {
	const [owner, name] = repository.split("/");
	if (!owner || !name) return false;
	return [name, ...(RENAMED_REPOSITORIES[name.toLowerCase()] ?? [])].some(
		(candidate) => origin?.repository === `https://github.com/${owner}/${candidate}.git`,
	);
}

export function verifiedService(
	request: Request,
	actual: Record<string, unknown>,
	service: Record<string, unknown>,
	running: Record<string, unknown>,
): boolean {
	const origin = actual.origin as Record<string, unknown> | null;
	return (
		actual.source === join(request.install, "versions", request.version) &&
		actual.version === request.version &&
		actual.install === request.install &&
		origin?.tag === request.tag &&
		originMatches(origin, request.repository) &&
		typeof origin.commit === "string" &&
		/^[a-f0-9]{40}$/.test(origin.commit) &&
		service.loaded === true &&
		typeof service.pid === "number" &&
		service.pid > 0 &&
		service.home === request.home &&
		service.install === request.install &&
		running.ready === true &&
		running.home === request.home &&
		running.pid === service.pid &&
		running.version === request.version &&
		running.commit === origin.commit
	);
}
export async function runUpdate(request: Request): Promise<void> {
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
		const serviceBefore = json(
			await execute(executable, ["service", "status", "--home", request.home, "--json"], request, 30_000),
		);
		evidence.serviceBefore = serviceBefore;
		const runningBefore = json(
			await execute(executable, ["service", "info", "--home", request.home, "--json"], request, 30_000),
		);
		evidence.runningBefore = runningBefore;
		if (request.defer) {
			const until = Date.now() + 30 * 60_000;
			let busy = Number(runningBefore.active ?? 0);
			while (busy > 0 && Date.now() < until) {
				await new Promise((resolve) => setTimeout(resolve, 60_000));
				busy = Number(
					json(await execute(executable, ["service", "info", "--home", request.home, "--json"], request, 30_000))
						.active ?? 0,
				);
			}
			evidence.deferredMs = Date.now() - Date.parse(base.startedAt);
		}
		if (
			before.install !== request.install ||
			before.source !== join(request.install, "versions", String(before.version)) ||
			serviceBefore.install !== request.install ||
			serviceBefore.home !== request.home ||
			serviceBefore.loaded !== true ||
			runningBefore.ready !== true ||
			runningBefore.home !== request.home ||
			typeof runningBefore.pid !== "number" ||
			runningBefore.pid <= 0 ||
			runningBefore.pid !== serviceBefore.pid ||
			runningBefore.version !== before.version ||
			typeof runningBefore.commit !== "string" ||
			runningBefore.commit !== (before.origin as Record<string, unknown> | null)?.commit
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
		let service: Record<string, unknown> = {},
			running: Record<string, unknown> = {};
		const deadline = Date.now() + 30_000;
		let verified = false;
		do {
			try {
				service = json(
					await execute(executable, ["service", "status", "--home", request.home, "--json"], request, 5000),
				);
				evidence.service = service;
				running = json(await execute(executable, ["service", "info", "--home", request.home, "--json"], request, 5000));
				evidence.running = running;
				verified =
					verifiedService(request, actual, service, running) &&
					(before.version === request.version || running.pid !== runningBefore.pid);
			} catch (error) {
				evidence.readinessError = String(error);
			}
			if (verified || Date.now() >= deadline) break;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} while (Date.now() < deadline);
		result = {
			...base,
			...evidence,
			status: verified ? "verified" : "verification-failed",
			verified,
		};
	} catch (error) {
		// Preserve the installed versions; rollback is an explicit update --to operation.
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
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const requestPath = process.argv[2];
	if (!requestPath) throw new Error("Missing private update job request");
	await runUpdate(JSON.parse(await readFile(requestPath, "utf8")) as Request);
}
