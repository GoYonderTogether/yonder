import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginAPI } from "@yonder/sdk";
import type { Job, RecordRun } from "./job.js";

export async function atomic(path: string, value: unknown) {
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
		for (let attempt = 0; ; attempt++) {
			try {
				await rename(temp, path);
				return;
			} catch (error) {
				// Windows readers/scanners can briefly block replacement; retry only rename (5 waits, 620ms total).
				// Never unlink the durable target.
				if (
					process.platform !== "win32" ||
					!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") ||
					attempt >= 5
				)
					throw error;
				await delay(20 * 2 ** attempt);
			}
		}
	} catch (error) {
		await rm(temp, { force: true }).catch(() => {});
		throw error;
	}
}
export const saveJobs = (api: PluginAPI, jobs: Job[]) => atomic(join(api.paths.data, "jobs.json"), jobs);
export const recordRun = (api: PluginAPI, run: RecordRun) =>
	atomic(join(api.paths.data, "runs", `${run.id}.json`), run);
/** Missing jobs.json is an empty schedule; any other read failure is reported as-is. */
export async function loadJobs(api: PluginAPI): Promise<Job[]> {
	try {
		return JSON.parse(await readFile(join(api.paths.data, "jobs.json"), "utf8")) as Job[];
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		return [];
	}
}
export async function loadRuns(api: PluginAPI): Promise<RecordRun[]> {
	const runs: RecordRun[] = [];
	for (const file of await readdir(join(api.paths.data, "runs"))) {
		if (!file.endsWith(".json")) continue;
		runs.push(JSON.parse(await readFile(join(api.paths.data, "runs", file), "utf8")) as RecordRun);
	}
	return runs;
}
