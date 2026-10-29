import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { createStore } from "../store/index.js";
import { updateRelease } from "./index.js";
import { recordUpdateResult, type UpdateResult } from "./result.js";

async function database(home: string) {
	await mkdir(join(home, ".yonder"), { recursive: true });
	const db = await openDatabase(join(home, ".yonder/state.db"));
	await createStore(db);
	await db.close();
}

test("offline update completion uses the existing ledger once and leaves no model runs", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-result-"));
	try {
		await database(home);
		const data: UpdateResult = {
			updateId: randomUUID(),
			install: join(home, "install"),
			home,
			repository: "https://github.com/GoYonderTogether/yonder-harness.git",
			status: "failed-or-unknown",
			verified: false,
		};
		const first = await recordUpdateResult(data);
		expect(await recordUpdateResult(data)).toBe(first);
		const db = await openDatabase(join(home, ".yonder/state.db"), true);
		try {
			const store = await createStore(db, undefined, true);
			expect((await store.events.query({ type: "release.update-result" })).events).toHaveLength(1);
			expect((await store.events.query({ type: "run.end" })).events).toHaveLength(0);
		} finally {
			await db.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("real isolated update of a prepared artifact records restart-required, no-op emits nothing, and failure stays failed", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-direct-update-"));
	const previous = process.env.YONDER_INSTALL;
	const install = join(home, "install"),
		version = "0.1.2026101905",
		directory = join(install, "versions", version);
	try {
		process.env.YONDER_INSTALL = install;
		await database(home);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, "package.json"), JSON.stringify({ workspaces: [] }));
		// Prepared artifact fixture: exercise the real link/install/receipt path, not a release build or launchd deployment.
		await mkdir(join(directory, "packages/cli/dist"), { recursive: true });
		await writeFile(
			join(directory, "packages/cli/dist/index.js"),
			await readFile(new URL("../../../cli/dist/index.js", import.meta.url)),
		);
		await writeFile(
			join(directory, ".yonder-install.json"),
			JSON.stringify({ tag: `v${version}`, repository: home, commit: "0".repeat(40), version }),
		);
		const result = await updateRelease({ home, to: `v${version}`, repo: home });
		expect(result).toMatchObject({ updated: true, verified: false, status: "restart-required" });
		expect(await realpath(join(install, "current"))).toBe(await realpath(directory));
		expect(await updateRelease({ home, to: `v${version}`, repo: home })).toMatchObject({ updated: false });
		await expect(
			updateRelease({ home, to: "v0.1.2026101906", repo: join(home, "missing-repository") }),
		).rejects.toThrow();
		const db = await openDatabase(join(home, ".yonder/state.db"), true);
		try {
			const page = await (await createStore(db, undefined, true)).events.query({ type: "release.update-result" });
			expect(page.events.map((e) => (e.data as UpdateResult).status)).toEqual([
				"restart-required",
				"failed-or-unknown",
			]);
		} finally {
			await db.close();
		}
		await access(join(install, "versions", version));
	} finally {
		if (previous === undefined) delete process.env.YONDER_INSTALL;
		else process.env.YONDER_INSTALL = previous;
		await rm(home, { recursive: true, force: true });
	}
});

test("a starting kernel's fresh lock is never taken over, a long-dead lock is", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-result-lock-"));
	try {
		await database(home);
		const data: UpdateResult = {
			updateId: randomUUID(),
			install: join(home, "install"),
			home,
			repository: "https://github.com/GoYonderTogether/yonder-harness.git",
			status: "failed-or-unknown",
			verified: false,
		};
		// A booting kernel holds the lock but its control socket is not listening yet.
		await mkdir(join(home, ".yonder/lock"));
		const held = (await stat(join(home, ".yonder/lock"))).mtimeMs;
		await expect(recordUpdateResult(data, { wait: 300, poll: 50 })).rejects.toMatchObject({ code: "ELOCKED" });
		expect((await stat(join(home, ".yonder/lock"))).mtimeMs).toBe(held);
		// Nothing refreshed it for far longer than any starting kernel needs: the holder is gone.
		const old = new Date(Date.now() - 600000);
		await utimes(join(home, ".yonder/lock"), old, old);
		expect(await recordUpdateResult(data, { wait: 300, poll: 50 })).toMatch(/^[0-9A-Z]{26}$/u);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
