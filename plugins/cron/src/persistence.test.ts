import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { createFilePluginStorage } from "@yonder/sdk/testing";
import { afterEach, expect, test } from "vitest";
import type { Job, RecordRun } from "./job.js";
import { loadJobs, loadRuns, recordRun, saveJobs } from "./persistence.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
	const data = await mkdtemp(join(tmpdir(), "cron-plugin-storage-"));
	directories.push(data);
	return { data, api: { storage: createFilePluginStorage(data) } as PluginAPI };
}

test("reads and writes the existing jobs.json and runs/<id>.json formats through plugin storage", async () => {
	const { data, api } = await fixture();
	const job = { id: "job-1", name: "existing", enabled: true } as Job;
	const run = { id: "run-1", job: job.id, status: "done" } as RecordRun;
	const files = api.storage.open();
	await files.write("jobs.json", JSON.stringify([job]));
	await files.mkdir("runs");
	await files.write("runs/run-1.json", JSON.stringify(run));

	expect(await loadJobs(api)).toEqual([job]);
	expect(await loadRuns(api)).toEqual([run]);
	await saveJobs(api, [job]);
	await recordRun(api, run);
	expect(JSON.parse(await readFile(join(data, "jobs.json"), "utf8"))).toEqual([job]);
	expect(JSON.parse(await readFile(join(data, "runs/run-1.json"), "utf8"))).toEqual(run);
});

test("a missing jobs file is an empty schedule", async () => {
	const { api } = await fixture();
	expect(await loadJobs(api)).toEqual([]);
});
