import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { parseDocument } from "yaml";
import { loadYonderConfig, parseYonderConfig } from "./index.js";

export interface GatewaySettings {
	enabled: boolean;
	port?: number;
	publicOrigins: string[];
	basePath: string;
	accessTokenHash?: string;
	trustProxy: boolean;
	remoteOwner: boolean;
	remoteAdmin: boolean;
}

async function replace(file: string, temp: string): Promise<void> {
	for (let retries = 0; ; retries++) {
		try {
			await rename(temp, file);
			return;
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : undefined;
			if (process.platform !== "win32" || code !== "EPERM" || retries === 5) throw error;
			await sleep(20 * 2 ** retries);
		}
	}
}

/** Gateway settings with defaults applied; read from yonder.yaml on every call so a rotated token takes effect without restart. */
export async function gatewaySettings(home: string): Promise<GatewaySettings> {
	const config = (await loadYonderConfig(home)).gateway ?? {};
	return {
		enabled: config.enabled ?? true,
		...(config.port === undefined ? {} : { port: config.port }),
		publicOrigins: config.publicOrigins ?? [],
		basePath: config.basePath ?? "/",
		trustProxy: config.trustProxy ?? false,
		remoteOwner: config.remoteOwner ?? false,
		remoteAdmin: config.remoteAdmin ?? false,
		...(config.accessTokenHash ? { accessTokenHash: config.accessTokenHash } : {}),
	};
}

/** Store only the hash of the long-lived access token; comments and other keys in yonder.yaml are preserved. */
export async function setAccessTokenHash(home: string, hash: string): Promise<void> {
	const file = join(home, "yonder.yaml");
	const unlock = await lockfile.lock(file);
	try {
		const document = parseDocument(await readFile(file, "utf8"));
		document.setIn(["gateway", "accessTokenHash"], hash);
		const text = document.toString();
		parseYonderConfig(text, file);
		const temp = `${file}.${randomUUID()}.tmp`;
		let operationError: unknown;
		let operationFailed = false;
		try {
			await writeFile(temp, text, { mode: 0o600, flag: "wx" });
			await replace(file, temp);
		} catch (error) {
			operationError = error;
			operationFailed = true;
		}
		let cleanupError: unknown;
		let cleanupFailed = false;
		try {
			await rm(temp, { force: true });
		} catch (error) {
			cleanupError = error;
			cleanupFailed = true;
		}
		if (operationFailed && cleanupFailed)
			throw new AggregateError([operationError, cleanupError], "Gateway config update and temp cleanup failed", {
				cause: operationError,
			});
		if (operationFailed) throw operationError;
		if (cleanupFailed) throw cleanupError;
	} finally {
		await unlock();
	}
}
