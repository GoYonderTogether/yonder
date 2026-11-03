import type { PluginAPI } from "@yonder/sdk";
import type { Job, RecordRun } from "./job.js";

const files = (api: PluginAPI) => api.storage.open();
const serialize = (value: unknown) => JSON.stringify(value, null, 2);

export const saveJobs = (api: PluginAPI, jobs: Job[]) =>
	files(api).transaction((tree) => tree.write("jobs.json", serialize(jobs)));

export const recordRun = (api: PluginAPI, run: RecordRun) =>
	files(api).transaction(async (tree) => {
		await tree.mkdir("runs");
		await tree.write(`runs/${run.id}.json`, serialize(run));
	});

/** Missing jobs.json is an empty schedule; storage errors and malformed JSON remain visible. */
export async function loadJobs(api: PluginAPI): Promise<Job[]> {
	const value = await files(api).read("jobs.json");
	return value === undefined ? [] : (JSON.parse(value) as Job[]);
}

export async function loadRuns(api: PluginAPI): Promise<RecordRun[]> {
	const tree = files(api);
	const runs: RecordRun[] = [];
	for (const file of await tree.list("runs")) {
		if (file.type !== "file" || !file.name.endsWith(".json")) continue;
		const value = await tree.read(`runs/${file.name}`);
		if (value !== undefined) runs.push(JSON.parse(value) as RecordRun);
	}
	return runs;
}
