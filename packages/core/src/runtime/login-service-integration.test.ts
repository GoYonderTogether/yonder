import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { createLoginChildRunner } from "./login-child-runner.js";
import { createLoginOperationService } from "./login-operation-service.js";

it("integrates handler, real wrapper child, SQLite completion/outbox and bound-session wake", async () => {
	const dir = await mkdtemp(join(tmpdir(), "login-integration-"));
	const db = await openDatabase(join(dir, "db.sqlite"));
	try {
		const wrapper = join(dir, "wrapper.sh");
		const fakeCli = join(dir, "fake-cli.sh");
		await writeFile(fakeCli, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
		await writeFile(wrapper, `#!/bin/sh\nexec /bin/sh '${fakeCli}' "$@"\n`, { mode: 0o700 });
		const wakes: Array<{ session: string; outcome: string; key: string }> = [];
		const runner = createLoginChildRunner({
			home: dir,
			providers: new Map([["fake", { command: "/bin/bash", args: [wrapper, "login", "fake"] }]]),
			spawnTerminal: (command, args, options) =>
				spawn(command, args, { cwd: options.cwd, env: options.env, stdio: "ignore" }),
		});
		const service = createLoginOperationService({
			db,
			runner,
			deliver: async (entry, key) => {
				wakes.push({ session: entry.session, outcome: entry.outcome, key });
				return "delivered";
			},
		});
		await service.initialize();
		const ctx = {
			session: "bound-session",
			agent: "agent",
			event: { id: "source-event" },
			capabilities: [],
			signal: new AbortController().signal,
		} as unknown as ToolContext;
		const pending = await service.handler({ provider: "fake" }, ctx);
		const pendingResult = JSON.parse(pending.text) as { id: string; status: string };
		expect(pendingResult.status).toBe("pending");
		await expect
			.poll(async () => db.get<{ state: string }>("SELECT state FROM login_operations WHERE id=?", pendingResult.id), {
				timeout: 5000,
			})
			.toMatchObject({ state: "succeeded" });
		expect(await service.drainOutbox()).toBe(1);
		expect(wakes).toEqual([{ session: "bound-session", outcome: "succeeded", key: pendingResult.id }]);
		expect(await db.all("SELECT id FROM login_outbox WHERE acknowledged_at IS NOT NULL")).toHaveLength(1);
	} finally {
		await db.close();
		await rm(dir, { recursive: true, force: true });
	}
});
