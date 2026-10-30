import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { windowsUpdateJob } from "../plugins/channel-github/dist/windows-jobs.js";

if (process.platform !== "win32") throw new Error("Native Windows required");
const root = await mkdtemp(join(tmpdir(), "yonder-update-job-")),
	id = randomUUID();
const signal = () => AbortSignal.timeout(15000);
try {
	await writeFile(join(root, "request.json"), JSON.stringify({ id, result: join(root, "result.json") }));
	// Actual one-shot OS worker; only a generated receipt, no simulated updater/model.
	await writeFile(
		join(root, "update-job.mjs"),
		`import{readFile,writeFile}from'node:fs/promises';const r=JSON.parse(await readFile(process.argv[2],'utf8'));await writeFile(r.result,JSON.stringify({id:r.id,pid:process.pid}));`,
	);
	await windowsUpdateJob("start", root, signal());
	let result;
	for (let i = 0; i < 100; i++) {
		try {
			result = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
			break;
		} catch {
			await sleep(100);
		}
	}
	assert.equal(result?.id, id);
	assert.ok(result.pid > 0);
	await assert.rejects(windowsUpdateJob("start", root, signal()));
	console.log(
		"PASS: real independent Windows one-shot task executes copied worker, emits exact receipt, rejects duplicate registration",
	);
} finally {
	try {
		await windowsUpdateJob("remove", root, signal());
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
