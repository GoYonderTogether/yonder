import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	commandDigest,
	type DeviceDescriptor,
	type DeviceSession,
	DeviceSessionSchema,
	decodeCommand,
	type Origin,
	OriginSchema,
} from "@yonder/sdk";
import { Check } from "typebox/value";

export interface PendingCommand {
	commandBase64: string;
	payloadSha256: string;
	origin: Origin;
	targetId: string;
	preparedAt: string;
}
export interface StoredSession {
	session: DeviceSession;
	closed: boolean;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function part(value: string, principal = false): string {
	if (!(principal ? /^[a-f0-9]{64}$/ : uuid).test(value)) throw new Error("INVALID_REQUEST");
	return value;
}

async function read(path: string): Promise<unknown | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

/** Publish only fully synced bytes. An existing command is never replaced. */
async function save(path: string, value: unknown, exclusive = false): Promise<boolean> {
	const dir = dirname(path);
	const firstCreated = await mkdir(dir, { recursive: true, mode: 0o700 });
	const temporary = join(dir, `.${randomUUID()}.tmp`);
	const file = await open(temporary, "wx", 0o600);
	let published = false;
	try {
		try {
			await file.writeFile(JSON.stringify(value));
			await file.sync();
		} finally {
			await file.close();
		}
		if (exclusive) await link(temporary, path);
		else await rename(temporary, path);
		published = true;
	} catch (error) {
		if (!exclusive || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	} finally {
		await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
	}
	// Newly created ancestors also need syncing before any first dispatch.
	// Windows rejects fsync on a directory handle (EPERM); NTFS journals metadata itself.
	if (process.platform !== "win32") {
		const stop = firstCreated ? dirname(firstCreated) : dir;
		for (let current = dir; ; current = dirname(current)) {
			const directory = await open(current, "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
			if (current === stop) break;
		}
	}
	return published;
}

export class ControllerStore {
	constructor(readonly data: string) {}
	private commandPath(deviceId: string, principalId: string, commandId: string): string {
		return join(this.data, "commands", part(deviceId), part(principalId, true), `${part(commandId)}.json`);
	}
	async command(deviceId: string, principalId: string, commandId: string): Promise<PendingCommand | undefined> {
		const value = (await read(this.commandPath(deviceId, principalId, commandId))) as PendingCommand | undefined;
		if (value === undefined) return undefined;
		const decoded = decodeCommand(value.commandBase64, { deviceId, principalId });
		if (
			decoded.commandId !== commandId ||
			commandDigest(value.commandBase64) !== value.payloadSha256 ||
			!Check(OriginSchema, value.origin) ||
			typeof value.targetId !== "string" ||
			typeof value.preparedAt !== "string"
		)
			throw new Error("Corrupt controller command record; refusing to dispatch");
		return value;
	}
	async prepare(deviceId: string, principalId: string, commandId: string, value: PendingCommand): Promise<boolean> {
		return save(this.commandPath(deviceId, principalId, commandId), value, true);
	}
	async session(deviceId: string, principalId: string, id: string): Promise<StoredSession> {
		const value = (await read(
			join(this.data, "sessions", part(deviceId), part(principalId, true), `${part(id)}.json`),
		)) as StoredSession | undefined;
		if (!value || !Check(DeviceSessionSchema, value.session) || typeof value.closed !== "boolean")
			throw new Error("Unknown device session; open an explicit session first");
		if (
			value.session.deviceId !== deviceId ||
			value.session.principalId !== principalId ||
			value.session.deviceSessionId !== id
		)
			throw new Error("WRONG_TARGET");
		return value;
	}
	async saveSession(value: StoredSession): Promise<void> {
		const s = value.session;
		await save(
			join(this.data, "sessions", part(s.deviceId), part(s.principalId, true), `${part(s.deviceSessionId)}.json`),
			value,
		);
	}
	async cache(device: DeviceDescriptor): Promise<void> {
		await save(join(this.data, "observations", `${part(device.deviceId)}.json`), device);
	}
	async cached(deviceId: string): Promise<unknown> {
		return read(join(this.data, "observations", `${part(deviceId)}.json`));
	}
}
