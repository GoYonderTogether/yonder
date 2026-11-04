/**
 * Connector state lives only under `<OPENCLAW_STATE_DIR>/yonder/` (spec 23 §3):
 * `config.json` is written by `@yonder/connect` (endpoint + device token),
 * `state.json` by the connector (Bot ↔ session mapping and delivery cursors).
 * Nothing else in the state root, and no process environment, is touched.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { emptyState, type ConnectorConfig, type ConnectorState } from "./frames.js";

export { parseFrame, isUuid, WORK_METHODS, stateDir } from "./frames.js";
export type { InboundFrame, CloudMessage, MessageContent, ConnectorConfig, ConnectorState } from "./frames.js";

export interface PersistedConfig {
	endpoint: string;
	deviceToken: string;
}

export function readConfig(dir: string): PersistedConfig | undefined {
	const path = join(dir, "config.json");
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return undefined;
		const row = parsed as Record<string, unknown>;
		if (typeof row.endpoint !== "string" || typeof deviceTokenOf(row) !== "string") return undefined;
		if (!row.endpoint || !deviceTokenOf(row)) return undefined;
		return { endpoint: row.endpoint, deviceToken: deviceTokenOf(row) as string };
	} catch {
		return undefined;
	}
}

function deviceTokenOf(row: Record<string, unknown>): unknown {
	return row.deviceToken;
}

export function readState(dir: string): ConnectorState {
	const path = join(dir, "state.json");
	if (!existsSync(path)) return emptyState();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return emptyState();
		const row = parsed as Record<string, unknown>;
		return {
			botSessions: strings(row.botSessions),
			cursors: numbers(row.cursors),
		};
	} catch {
		return emptyState();
	}
}

/** Write with owner-only permissions; the directory is 0700. */
export function writeSecure(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	chmodSync(dirname(path), 0o700);
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
}

export function writeState(dir: string, state: ConnectorState): void {
	writeSecure(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

export function clearStateDir(dir: string): string[] {
	const removed: string[] = [];
	for (const name of ["config.json", "state.json"]) {
		const path = join(dir, name);
		if (!existsSync(path)) continue;
		try {
			unlinkSync(path);
			removed.push(path);
		} catch {
			/* A concurrent writer removed it first; the postcondition still holds. */
		}
	}
	return removed;
}

function strings(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return out;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item === "string" && item) out[key] = item;
	}
	return out;
}

function numbers(value: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return out;
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
	}
	return out;
}
