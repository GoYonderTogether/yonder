#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
/**
 * Node >=22.19, stdlib only. Usage:
 * node --disable-warning=ExperimentalWarning scripts/export-model-observations.mjs --db /absolute/state.db > attempts.jsonl 2> counts.json
 * stdout: one projected row per attempt; stderr: one JSON counts object.
 * Scope is exactly one database, no backup discovery. First entry by id wins for
 * duplicate phases; conflicts are counted. No usage sums, rates or inferred ends.
 * Assistant rows (including newer uncorrelated rows) are counted separately only.
 */
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const usageFields = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"];
const timingFields = [
	"firstNormalizedEventMs",
	"firstTextDeltaMs",
	"lastTextDeltaMs",
	"firstThinkingDeltaMs",
	"lastThinkingDeltaMs",
	"firstToolDeltaMs",
	"lastToolDeltaMs",
	"firstEffectiveDeltaMs",
	"lastEffectiveDeltaMs",
	"endMs",
];
const countFields = ["textDeltaCount", "thinkingDeltaCount", "toolDeltaCount"];
const statuses = ["stop", "length", "toolUse", "error", "aborted", "deferred", "throw"];
const efforts = ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "default"];
const modes = ["enabled", "disabled", "adaptive", "auto", "on", "off"];
const unsupported = [
	"responseHeadersMs",
	"firstProviderEventMs",
	"firstBodyByteMs",
	"serverActualEffort",
	"accountSlotId",
	"rateSnapshot",
];
const fields = new Map();
function field(name, path = `$.data.${name}`) {
	fields.set(name, path);
}
for (const name of [
	"version",
	"phase",
	"operation",
	"logicalRequestId",
	"attemptId",
	"attemptNo",
	"requestThinking",
	"startedAtMs",
	"endedAtMs",
	"elapsedMs",
	"status",
	"errorClass",
	"httpStatus",
])
	field(name);
for (const name of ["model", "provider", "api"]) field(`selected.${name}`);
for (const name of usageFields) field(`usage.${name}`);
field("observation.version");
for (const name of [...timingFields, ...countFields]) field(`observation.timing.${name}`);
field("observation.usage.support");
for (const name of usageFields) {
	field(`observation.usage.${name}.value`);
	field(`observation.usage.${name}.source`);
}
for (const name of ["support", "requested", "clamped", "wire.effort", "wire.mode", "wire.budgetTokens"])
	field(`observation.effort.${name}`);
field("observation.reportedResponseModel");
// Project individual array leaves, never a JSON object or arbitrary array contents.
for (let i = 0; i < unsupported.length; i++) field(`unsupported${i}`, `$.data.observation.unsupported[${i}]`);
const columns = [...fields]
	.flatMap(([name, path]) => [
		`CASE WHEN json_type(r, '${path}') IN ('integer','real','text','null') THEN json_extract(r, '${path}') END AS "${name}"`,
		`json_type(r, '${path}') AS "${name}:type"`,
	])
	.join(",\n");
const base = `WITH records AS (SELECT id, CASE WHEN json_valid(record) THEN record ELSE '{}' END AS r FROM pi_entries)`;

function text(row, key) {
	return row[`${key}:type`] === "text" ? row[key] : null;
}
function number(row, key, integer = false) {
	const value = row[key];
	return ["integer", "real"].includes(row[`${key}:type`]) &&
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		value <= Number.MAX_SAFE_INTEGER &&
		(!integer || Number.isSafeInteger(value))
		? value
		: null;
}
function choice(value, values) {
	return values.includes(value) ? value : null;
}
function label(value) {
	return typeof value === "string" &&
		/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/.test(value) &&
		!value.includes("//") &&
		!/(^|\/)(sk[-_]|bearer|api[-_]?key|token[-_])/i.test(value)
		? value
		: null;
}
function observation(row) {
	if (number(row, "observation.version", true) !== 1) return null;
	const timing = {};
	for (const name of timingFields) timing[name] = number(row, `observation.timing.${name}`);
	for (const name of countFields) timing[name] = number(row, `observation.timing.${name}`, true);
	const usage = { support: choice(text(row, "observation.usage.support"), ["supported", "unsupported"]) };
	for (const name of usageFields) {
		const key = `observation.usage.${name}`;
		const value = number(row, `${key}.value`);
		const source = choice(text(row, `${key}.source`), ["reported", "derived", "unknown"]);
		usage[name] = { value, source: value === null ? "unknown" : (source ?? "unknown") };
	}
	const wireEffort = number(row, "observation.effort.wire.effort");
	return {
		version: 1,
		timing,
		usage,
		responseHeadersMs: null,
		firstProviderEventMs: null,
		firstBodyByteMs: null,
		accountSlotId: null,
		rateSnapshot: null,
		effort: {
			support: choice(text(row, "observation.effort.support"), ["supported", "unsupported"]),
			requested: choice(text(row, "observation.effort.requested"), efforts),
			clamped: choice(text(row, "observation.effort.clamped"), efforts),
			wire: {
				effort: wireEffort ?? choice(text(row, "observation.effort.wire.effort"), efforts),
				mode: choice(text(row, "observation.effort.wire.mode"), modes),
				budgetTokens: number(row, "observation.effort.wire.budgetTokens", true),
			},
			serverActual: null,
		},
		reportedResponseModel: label(text(row, "observation.reportedResponseModel")),
		unsupported: unsupported.filter((name) => unsupported.some((_, i) => text(row, `unsupported${i}`) === name)),
	};
}
function project(row) {
	const phase = choice(text(row, "phase"), ["start", "end"]);
	const operation = choice(text(row, "operation"), ["generation", "compaction"]);
	const attemptId = text(row, "attemptId");
	const logicalRequestId = text(row, "logicalRequestId");
	const attemptNo = number(row, "attemptNo", true);
	const startedAtMs = number(row, "startedAtMs");
	if (
		number(row, "version", true) !== 1 ||
		!phase ||
		!operation ||
		!attemptNo ||
		startedAtMs === null ||
		!/^[0-9]{1,20}$/.test(logicalRequestId ?? "") ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId ?? "")
	)
		return null;
	const identity = {
		version: 1,
		operation,
		logicalRequestId,
		attemptId: attemptId.toLowerCase(),
		attemptNo,
		selected: Object.fromEntries(
			["model", "provider", "api"].map((name) => [name, label(text(row, `selected.${name}`))]),
		),
		requestThinking: choice(text(row, "requestThinking"), efforts),
		startedAtMs,
	};
	const usage = Object.fromEntries(usageFields.map((name) => [name, number(row, `usage.${name}`)]));
	const httpStatus = number(row, "httpStatus", true);
	return {
		phase,
		identity,
		terminal:
			phase === "end"
				? {
						endedAtMs: number(row, "endedAtMs"),
						elapsedMs: number(row, "elapsedMs"),
						status: choice(text(row, "status"), statuses) ?? "unknown",
						errorClass: choice(text(row, "errorClass"), ["cancelled", "provider_error", "unknown"]),
						httpStatus: httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
						usage,
						observation: observation(row),
					}
				: null,
	};
}

/** The caller supplies a sink; only explicitly projected objects reach it. */
export function exportObservations(dbPath, emit) {
	const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
	try {
		db.exec("PRAGMA query_only = ON; BEGIN");
		const summary = {
			type: "model-observation-counts",
			version: 1,
			scope: "one-database",
			observationEntries: 0,
			invalidEntries: 0,
			duplicatePhases: 0,
			duplicateConflicts: 0,
			identityConflicts: 0,
			starts: 0,
			ends: 0,
			attempts: 0,
			endWithoutStart: 0,
			byOperation: {},
			byStatus: {},
			byOperationStatus: {},
			observation: { present: 0, missing: 0 },
			usage: Object.fromEntries(usageFields.map((name) => [name, { present: 0, missing: 0 }])),
			observedUsage: Object.fromEntries(usageFields.map((name) => [name, { reported: 0, derived: 0, unknown: 0 }])),
			legacy: { assistantRows: 0, timingUnknown: 0, usageProvenanceUnknown: 0, includedInAttempts: false },
			malformedRecords: db.prepare("SELECT count(*) AS n FROM pi_entries WHERE NOT json_valid(record)").get().n,
		};
		const legacyCount = db
			.prepare(`${base} SELECT count(*) AS n FROM records WHERE json_extract(r, '$.kind') = 'pi.assistant'`)
			.get().n;
		summary.legacy.assistantRows = legacyCount;
		summary.legacy.timingUnknown = db
			.prepare(
				`${base} SELECT count(*) AS n FROM records WHERE json_extract(r, '$.kind') = 'pi.assistant' AND json_extract(r, '$.model[0].observation.timing.endMs') IS NULL`,
			)
			.get().n;
		summary.legacy.usageProvenanceUnknown = db
			.prepare(
				`${base} SELECT count(*) AS n FROM records WHERE json_extract(r, '$.kind') = 'pi.assistant' AND coalesce(json_extract(r, '$.model[0].observation.version'), 0) != 1`,
			)
			.get().n;
		const attempts = new Map();
		for (const row of db
			.prepare(
				`${base} SELECT ${columns} FROM records WHERE json_extract(r, '$.kind') = 'pi.model-observation' ORDER BY id`,
			)
			.iterate()) {
			summary.observationEntries++;
			const entry = project(row);
			if (!entry) {
				summary.invalidEntries++;
				continue;
			}
			let pair = attempts.get(entry.identity.attemptId);
			if (!pair) {
				pair = {};
				attempts.set(entry.identity.attemptId, pair);
			}
			if (pair[entry.phase]) {
				summary.duplicatePhases++;
				if (JSON.stringify(pair[entry.phase]) !== JSON.stringify(entry)) summary.duplicateConflicts++;
			} else {
				pair[entry.phase] = entry;
				summary[entry.phase === "start" ? "starts" : "ends"]++;
			}
		}
		for (const pair of attempts.values()) {
			const identity = (pair.start ?? pair.end).identity;
			const conflict =
				pair.start && pair.end && JSON.stringify(pair.start.identity) !== JSON.stringify(pair.end.identity);
			if (conflict) summary.identityConflicts++;
			const terminal = conflict ? null : pair.end?.terminal;
			const row = {
				type: "model-attempt",
				...identity,
				phases: ["start", "end"].filter((phase) => pair[phase]),
				identityConflict: Boolean(conflict),
				status: terminal?.status ?? (pair.end ? "unknown" : "interrupted/unknown"),
				endedAtMs: terminal?.endedAtMs ?? null,
				elapsedMs: terminal?.elapsedMs ?? null,
				errorClass: terminal?.errorClass ?? null,
				httpStatus: terminal?.httpStatus ?? null,
				usage: terminal?.usage ?? Object.fromEntries(usageFields.map((name) => [name, null])),
				observation: terminal?.observation ?? null,
			};
			row.usageProvenance = Object.fromEntries(
				usageFields.map((name) => [
					name,
					row.usage[name] !== null && row.usage[name] === row.observation?.usage[name].value
						? row.observation.usage[name].source
						: "unknown",
				]),
			);
			summary.attempts++;
			if (!pair.start) summary.endWithoutStart++;
			summary.byOperation[row.operation] = (summary.byOperation[row.operation] ?? 0) + 1;
			summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + 1;
			summary.byOperationStatus[row.operation] ??= {};
			const group = summary.byOperationStatus[row.operation];
			group[row.status] = (group[row.status] ?? 0) + 1;
			summary.observation[row.observation ? "present" : "missing"]++;
			for (const name of usageFields) {
				summary.usage[name][row.usage[name] === null ? "missing" : "present"]++;
				summary.observedUsage[name][row.observation?.usage[name].source ?? "unknown"]++;
			}
			emit(row);
		}
		return summary;
	} finally {
		db.close();
	}
}

const usage =
	"Usage: node --disable-warning=ExperimentalWarning scripts/export-model-observations.mjs --db PATH\nstdout: attempt JSONL; stderr: JSON counts. Read-only, one DB, no backup scan.\n";
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === "--help") process.stdout.write(usage);
	else if (args.length !== 2 || args[0] !== "--db" || !args[1]) {
		process.stderr.write(usage);
		process.exitCode = 2;
	} else {
		try {
			const counts = exportObservations(args[1], (row) => process.stdout.write(`${JSON.stringify(row)}\n`));
			process.stderr.write(`${JSON.stringify(counts)}\n`);
		} catch {
			// Never echo SQLite diagnostics: a malformed value/path can itself contain secrets.
			process.stderr.write("Export failed: cannot read the requested SQLite observation source.\n");
			process.exitCode = 1;
		}
	}
}
