import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { exportObservations } from "./export-model-observations.mjs";

// Deterministic storage/parser fixtures, not simulated model calls.
const id = (n) => `019a0000-0000-7000-8000-${String(n).padStart(12, "0")}`;
function entry(n, phase = "start", overrides = {}) {
	return {
		kind: "pi.model-observation",
		data: {
			version: 1,
			phase,
			operation: "generation",
			logicalRequestId: "42",
			attemptId: id(n),
			attemptNo: 1,
			selected: { model: "gpt-6-luna", provider: "openai", api: "openai-responses" },
			requestThinking: "high",
			startedAtMs: 1000,
			...(phase === "end"
				? {
						endedAtMs: 1100,
						elapsedMs: 100,
						status: "stop",
						errorClass: null,
						httpStatus: 200,
						usage: { input: 2, output: 10, reasoning: 4 },
					}
				: {}),
			...overrides,
		},
	};
}
function sidecar() {
	return {
		version: 1,
		timing: {
			firstNormalizedEventMs: 0,
			firstTextDeltaMs: 2,
			lastTextDeltaMs: 4,
			firstEffectiveDeltaMs: 2,
			lastEffectiveDeltaMs: 4,
			endMs: 5,
			textDeltaCount: 2,
			thinkingDeltaCount: 0,
			toolDeltaCount: 0,
		},
		usage: {
			support: "supported",
			input: { value: 0, source: "reported" },
			output: { value: 10, source: "reported" },
			reasoning: { value: 4, source: "reported" },
			cacheRead: { value: null, source: "unknown" },
			totalTokens: { value: 10, source: "derived" },
		},
		effort: {
			support: "supported",
			requested: "high",
			clamped: "medium",
			wire: { effort: "medium", mode: "adaptive", budgetTokens: 0 },
			serverActual: null,
		},
		reportedResponseModel: "gpt-6-luna",
		unsupported: ["responseHeadersMs", "firstProviderEventMs", "firstBodyByteMs", "serverActualEffort"],
	};
}
function fixture(t, entries) {
	const dir = mkdtempSync(join(tmpdir(), "t61-export-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const path = join(dir, "source.db");
	const db = new DatabaseSync(path);
	db.exec(
		"CREATE TABLE pi_entries (id INTEGER PRIMARY KEY, conversation_id INTEGER, commit_seq INTEGER, record TEXT NOT NULL)",
	);
	const insert = db.prepare("INSERT INTO pi_entries (conversation_id, commit_seq, record) VALUES (1, 1, ?)");
	for (const item of entries) insert.run(typeof item === "string" ? item : JSON.stringify(item));
	db.close();
	return { path, dir };
}
function run(path) {
	const rows = [];
	const counts = exportObservations(path, (row) => rows.push(row));
	return { rows, counts };
}

test("start/end, duplicate phases, retry IDs, compaction, orphan end and interrupted start", (t) => {
	const entries = [
		entry(1),
		entry(1, "end"),
		entry(1),
		entry(1, "end"),
		entry(2, "start", { attemptNo: 2 }),
		entry(2, "end", { attemptNo: 2, status: "error", errorClass: "provider_error", httpStatus: 429 }),
		entry(3, "start", { operation: "compaction" }),
		entry(3, "end", { operation: "compaction" }),
		entry(4),
		entry(5, "end"),
	];
	const { path, dir } = fixture(t, entries);
	const before = readFileSync(path);
	const names = readdirSync(dir);
	const { rows, counts } = run(path);
	assert.equal(rows.length, 5);
	assert.equal(counts.observationEntries, 10);
	assert.equal(counts.duplicatePhases, 2);
	assert.equal(counts.duplicateConflicts, 0);
	assert.equal(counts.starts, 4);
	assert.equal(counts.ends, 4);
	assert.equal(counts.endWithoutStart, 1);
	assert.deepEqual(counts.byOperation, { generation: 4, compaction: 1 });
	assert.deepEqual(counts.byStatus, { stop: 3, error: 1, "interrupted/unknown": 1 });
	assert.equal(counts.byOperationStatus.compaction.stop, 1);
	assert.equal(counts.usage.output.present, 4); // Not eight phases, not ten entries.
	assert.equal(rows[0].usage.output, 10); // Never output + reasoning.
	assert.equal(rows[0].usage.reasoning, 4);
	assert.equal(rows[0].usageProvenance.output, "unknown");
	assert.equal(rows[1].attemptNo, 2);
	assert.equal(rows[1].httpStatus, 429);
	assert.deepEqual(rows[3].phases, ["start"]);
	assert.equal(rows[3].endedAtMs, null);
	assert.equal(rows[3].elapsedMs, null);
	assert.equal(rows[3].usage.output, null);
	assert.equal(rows[3].status, "interrupted/unknown");
	assert.deepEqual(readFileSync(path), before);
	assert.deepEqual(readdirSync(dir), names);
});

test("legacy assistant rows stay separate, with unknown timing/provenance and no usage added", (t) => {
	const { path } = fixture(t, [
		entry(1),
		entry(1, "end"),
		{
			kind: "pi.assistant",
			model: [{ role: "assistant", durationMs: 99, usage: { output: 10000 }, content: "private" }],
		},
		{ kind: "pi.assistant", model: [{ role: "assistant", usage: { output: 0 } }] },
	]);
	const { rows, counts } = run(path);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].usage.output, 10);
	assert.deepEqual(counts.legacy, {
		assistantRows: 2,
		timingUnknown: 2,
		usageProvenanceUnknown: 2,
		includedInAttempts: false,
	});
	assert.equal(counts.attempts, 1);
});

test("explicit reported zero vs null/missing, derived source, and sidecar projection", (t) => {
	const { path } = fixture(t, [
		entry(1),
		entry(1, "end", {
			usage: { input: 0, output: 10, cacheRead: null },
			observation: sidecar(),
		}),
	]);
	const {
		rows: [row],
		counts,
	} = run(path);
	assert.equal(row.usage.input, 0);
	assert.equal(row.usage.cacheRead, null);
	assert.equal(row.usage.cacheWrite, null);
	assert.deepEqual(row.observation.usage.input, { value: 0, source: "reported" });
	assert.deepEqual(row.observation.usage.cacheRead, { value: null, source: "unknown" });
	assert.deepEqual(row.observation.usage.cacheWrite, { value: null, source: "unknown" });
	assert.equal(row.usageProvenance.input, "reported");
	assert.equal(row.usageProvenance.totalTokens, "unknown"); // Absent normalized value has no provenance.
	assert.deepEqual(counts.observedUsage.totalTokens, { reported: 0, derived: 1, unknown: 0 });
	assert.equal(row.observation.timing.firstNormalizedEventMs, 0);
	assert.equal(row.observation.timing.firstThinkingDeltaMs, null);
	assert.equal(row.observation.effort.wire.budgetTokens, 0);
	assert.deepEqual(counts.observation, { present: 1, missing: 0 });
	assert.deepEqual(counts.observedUsage.input, { reported: 1, derived: 0, unknown: 0 });
	assert.deepEqual(counts.usage.cacheRead, { present: 0, missing: 1 });
});

test("numeric schema validation rejects booleans, strings, negative, fractional counts and objects", (t) => {
	const observation = sidecar();
	observation.timing.textDeltaCount = 1.5;
	observation.timing.firstTextDeltaMs = true;
	observation.usage.input = { value: false, source: "reported" };
	observation.usage.output = { value: "123", source: "reported" };
	observation.effort.wire.budgetTokens = -1;
	const { path } = fixture(t, [
		entry(1, "end", {
			elapsedMs: "100",
			endedAtMs: true,
			httpStatus: 999,
			usage: { input: false, output: "10", reasoning: -1, totalTokens: { value: 12 } },
			observation,
		}),
		entry(2, "start", { attemptNo: true }),
		entry(3, "start", { startedAtMs: "1000" }),
		entry(4, "start", { logicalRequestId: "not-a-numeric-task" }),
		entry(5, "start", { version: "1" }),
		entry(6, "start", { attemptId: "not-a-uuid" }),
		entry(7, "start", { operation: "other" }),
		"{malformed",
	]);
	const {
		rows: [row],
		counts,
	} = run(path);
	assert.equal(counts.invalidEntries, 6);
	assert.equal(counts.malformedRecords, 1);
	assert.equal(counts.attempts, 1);
	assert.equal(row.elapsedMs, null);
	assert.equal(row.endedAtMs, null);
	assert.equal(row.httpStatus, null);
	assert.ok(Object.values(row.usage).every((value) => value === null));
	assert.equal(row.observation.timing.textDeltaCount, null);
	assert.equal(row.observation.timing.firstTextDeltaMs, null);
	assert.deepEqual(row.observation.usage.input, { value: null, source: "unknown" });
	assert.deepEqual(row.observation.usage.output, { value: null, source: "unknown" });
	assert.equal(row.observation.effort.wire.budgetTokens, null);
});

test("nested unknown fields, raw errors, prompt, args, headers, URLs and unsafe typed leaves never escape", (t) => {
	const secret = "https://private.invalid/key?token=BAIT_SECRET";
	const observation = sidecar();
	observation.unknown = { secret };
	observation.timing.raw = { secret };
	observation.usage.input.raw = secret;
	observation.usage.output.source = secret;
	observation.usage.cacheWrite = { value: { secret }, source: "reported" };
	observation.effort.requested = secret;
	observation.effort.wire.effort = { secret };
	observation.effort.wire.mode = secret;
	observation.effort.wire.headers = { authorization: secret };
	observation.effort.serverActual = { secret };
	observation.reportedResponseModel = secret;
	observation.unsupported = [secret, { secret }, ["firstBodyByteMs"]];
	const end = entry(1, "end", {
		observation,
		status: secret,
		errorClass: secret,
		httpStatus: secret,
		selected: { model: secret, provider: "sk-BAIT_SECRET", api: { secret }, unknown: secret },
		requestThinking: secret,
		error: { message: secret },
		prompt: secret,
		args: { secret },
		headers: { authorization: secret },
		url: secret,
		body: secret,
		text: secret,
		reasoning: secret,
		usage: { input: { secret }, output: 10, cost: { secret }, token: secret },
	});
	end.model = [{ content: secret, errorMessage: secret, arguments: { secret } }];
	end.raw = { secret };
	const { path } = fixture(t, [end]);
	const result = run(path);
	const serialized = JSON.stringify(result);
	assert.ok(!serialized.includes("BAIT_SECRET"));
	assert.ok(!serialized.includes("private.invalid"));
	const row = result.rows[0];
	assert.deepEqual(row.selected, { model: null, provider: null, api: null });
	assert.equal(row.status, "unknown");
	assert.equal(row.errorClass, null);
	assert.equal(row.usage.output, 10);
	assert.equal(row.observation.usage.output.source, "unknown");
	assert.equal(row.observation.effort.serverActual, null);
	assert.deepEqual(row.observation.unsupported, []);
});

test("all terminal statuses, explicit null sidecar and normalized-default/observed disagreement", (t) => {
	const statuses = ["stop", "length", "toolUse", "error", "aborted", "deferred", "throw"];
	const entries = statuses.map((status, i) => entry(i + 1, "end", { status, observation: null }));
	entries.push(entry(8, "end", { usage: { input: 0, output: 0 }, observation: sidecar() }));
	const { path } = fixture(t, entries);
	const { rows, counts } = run(path);
	assert.deepEqual(
		rows.slice(0, 7).map((row) => row.status),
		statuses,
	);
	assert.ok(rows.slice(0, 7).every((row) => row.observation === null));
	assert.deepEqual(counts.observation, { present: 1, missing: 7 });
	assert.equal(rows[7].usageProvenance.input, "reported");
	assert.equal(rows[7].usageProvenance.output, "unknown");
	assert.equal(rows[7].observation.usage.output.value, 10);
});

test("conflicting identities are unknown and do not lend timing/usage across attempts", (t) => {
	const { path } = fixture(t, [
		entry(1),
		entry(1, "end", { logicalRequestId: "43" }),
		entry(2, "end"),
		entry(2, "end", { usage: { output: 999 } }),
	]);
	const { rows, counts } = run(path);
	assert.equal(counts.identityConflicts, 1);
	assert.equal(rows[0].status, "unknown");
	assert.equal(rows[0].usage.output, null);
	assert.equal(rows[0].elapsedMs, null);
	assert.equal(counts.duplicateConflicts, 1);
	assert.equal(rows[1].usage.output, 10); // Documented first-by-id duplicate policy.
});

test("CLI emits JSONL and counts, rejects missing DB without creating it, and never echoes errors", (t) => {
	const { path, dir } = fixture(t, [entry(1), entry(1, "end")]);
	const script = fileURLToPath(new URL("./export-model-observations.mjs", import.meta.url));
	const cli = (...args) =>
		spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script, ...args], { encoding: "utf8" });
	const result = cli("--db", path);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim().split("\n").length, 1);
	assert.equal(JSON.parse(result.stdout).attemptId, id(1));
	assert.equal(JSON.parse(result.stderr).attempts, 1);
	const before = readdirSync(dir);
	const missing = cli("--db", join(dir, "BAIT_SECRET_missing.db"));
	assert.equal(missing.status, 1);
	assert.equal(missing.stdout, "");
	assert.ok(!missing.stderr.includes("BAIT_SECRET"));
	assert.deepEqual(readdirSync(dir), before);
	assert.equal(cli().status, 2);
	assert.equal(cli("--db", path, "--other").status, 2);
	assert.match(cli("--help").stdout, /one DB/);
});

test("CLI also runs when reached through a symlink", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "t61-export-symlink-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const link = join(dir, "export.mjs");
	symlinkSync(fileURLToPath(new URL("./export-model-observations.mjs", import.meta.url)), link);
	const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
	assert.equal(result.status, 0);
	assert.match(result.stdout, /Usage:/);
});

test("assistant sidecars are not counted as legacy missing metadata", (t) => {
	const { path } = fixture(t, [{ kind: "pi.assistant", model: [{ observation: sidecar() }] }]);
	const { counts, rows } = run(path);
	assert.equal(rows.length, 0);
	assert.equal(counts.legacy.assistantRows, 1);
	assert.equal(counts.legacy.timingUnknown, 0);
	assert.equal(counts.legacy.usageProvenanceUnknown, 0);
});
