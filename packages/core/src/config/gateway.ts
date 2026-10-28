import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
		await writeFile(temp, text, { mode: 0o600 });
		await rename(temp, file);
	} finally {
		await unlock();
	}
}
