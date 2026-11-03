import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Connector state lives only under `$DSH_HOME/yonder/` (spec 23 §3):
 * `config.json` is written by `@yonder/connect` (endpoint + device token),
 * `state.json` by the connector (Bot ↔ harness-agent mapping and delivery cursors).
 * Nothing else in the harness home, and no process environment, is touched.
 */

export interface ConnectorConfig {
	endpoint: string;
	deviceToken: string;
}

export interface ConnectorState {
	/** Cloud Bot account id → harness agent key (`preset:<id>`). */
	botAgents: Record<string, string>;
	/** Harness agent key → harness session id used for that Bot's conversation. */
	botSessions: Record<string, string>;
	/** `${agentId}:${convId}` → highest message seq accepted by the harness. */
	cursors: Record<string, number>;
}

const emptyState = (): ConnectorState => ({ botAgents: {}, botSessions: {}, cursors: {} });

/** `$DSH_HOME/yonder`; DSH_HOME defaults to `~/.dsh` exactly as DSH itself resolves it. */
export function stateDir(env: NodeJS.ProcessEnv = process.env, home = process.env.HOME ?? ""): string {
	const configured = env.DSH_HOME?.trim();
	const base = configured ? configured : join(home, ".dsh");
	return join(resolve(base), "yonder");
}

export function readConfig(dir: string): ConnectorConfig | undefined {
	const path = join(dir, "config.json");
	if (!existsSync(path)) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const row = parsed as Record<string, unknown>;
	if (typeof row.endpoint !== "string" || typeof row.deviceToken !== "string") return undefined;
	if (!row.endpoint || !row.deviceToken) return undefined;
	return { endpoint: row.endpoint, deviceToken: row.deviceToken };
}

export function readState(dir: string): ConnectorState {
	const path = join(dir, "state.json");
	if (!existsSync(path)) return emptyState();
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return emptyState();
		const row = parsed as Record<string, unknown>;
		return {
			botAgents: strings(row.botAgents),
			botSessions: strings(row.botSessions),
			cursors: numbers(row.cursors),
		};
	} catch {
		return emptyState();
	}
}

/** Write both files with owner-only permissions; the directory is 0700. */
export function writeSecure(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
