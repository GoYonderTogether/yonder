import { access, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { EventInput } from "@yonder/sdk";
import lockfile from "proper-lockfile";
import { requestControl } from "../control/index.js";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";

export interface UpdateResult {
	updateId: string;
	install: string;
	home: string;
	repository: string;
	beforeVersion?: string;
	version?: string;
	tag?: string;
	commit?: string;
	status: "verified" | "failed-or-unknown" | "restart-required";
	verified: boolean;
	service?: { version: string; commit: string; home: string; pid: number; ready: boolean };
	error?: string;
}

export function updateResultEvent(data: UpdateResult): EventInput {
	if (
		!data?.updateId ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(data.updateId) ||
		!isAbsolute(data.home) ||
		!isAbsolute(data.install) ||
		typeof data.repository !== "string" ||
		typeof data.verified !== "boolean" ||
		(data.status === "verified") !== data.verified ||
		!["verified", "failed-or-unknown", "restart-required"].includes(data.status)
	)
		throw new Error("Invalid update result");
	return {
		type: "release.update-result",
		conv: `conv:release:${data.updateId}`,
		data: { ...data, msgId: data.updateId },
	};
}

/** A kernel refreshes its lock every few seconds; one this fresh is alive even if it is still starting up. */
const LIVE_LOCK_MS = 120000;
async function kernelLockIsLive(home: string): Promise<boolean> {
	try {
		return Date.now() - (await stat(join(home, ".yonder/lock"))).mtimeMs < LIVE_LOCK_MS;
	} catch {
		return false;
	}
}

/**
 * One writer: use the running kernel, or take its existing home lock before writing offline. A kernel that is still
 * starting (fresh lock, control socket not up yet) is waited for, never displaced: its event loop can stay busy for
 * longer than proper-lockfile's default 10 s staleness, and a displaced lock crashes it (ECOMPROMISED).
 */
export async function recordUpdateResult(
	data: UpdateResult,
	options: { wait?: number; poll?: number } = {},
): Promise<string> {
	const event = updateResultEvent(data);
	const until = Date.now() + (options.wait ?? 180000);
	for (;;) {
		try {
			return ((await requestControl(data.home, { method: "release.result", params: { data } })) as { id: string }).id;
		} catch (error) {
			if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
		}
		if (Date.now() >= until || !(await kernelLockIsLive(data.home))) break;
		await sleep(options.poll ?? 1000);
	}
	await access(join(data.home, ".yonder/state.db"));
	const unlock = await lockfile.lock(data.home, {
		realpath: false,
		lockfilePath: join(data.home, ".yonder/lock"),
		stale: LIVE_LOCK_MS,
	});
	try {
		const db = await openDatabase(join(data.home, ".yonder/state.db"));
		try {
			return (await (await createStore(db)).events.record(event)).id;
		} finally {
			await db.close();
		}
	} finally {
		await unlock();
	}
}
