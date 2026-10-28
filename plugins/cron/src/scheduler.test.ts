import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { Scheduler } from "./index.js";

// Real filesystem/process integration; no model is started. Kernel permission
// re-resolution and channel delivery remain separate end-to-end acceptance.
test("persists owned jobs, executes a real command, prevents overlap and recovers without replay", async () => {
	const dir = await mkdtemp(join(tmpdir(), "yonder-cron-"));
	const events: YEvent[] = [];
	const ctx = {
		agent: null,
		session: "1",
		profile: "default",
		capabilities: ["write", "exec", "message"],
	} as ToolContext;
	const api = {
		paths: { data: dir },
		log: { error: () => {} },
		events: {
			async emit(input: object) {
				const event = { ...input, id: String(events.length + 1), ts: new Date().toISOString() } as YEvent;
				events.push(event);
				await writeFile(join(dir, "events.json"), JSON.stringify(events));
				return event;
			},
			async ask(input: object) {
				return { event: await this.emit(input), results: [] };
			},
		},
		execution: {
			async resolve() {
				return { capabilities: ctx.capabilities };
			},
			async run(input: { command: string | string[]; signal: AbortSignal }) {
				if (!ctx.capabilities.includes("exec")) throw new Error("exec revoked");
				const argv = typeof input.command === "string" ? ["/bin/sh", "-c", input.command] : input.command;
				const result = await promisify(execFile)(argv[0] as string, argv.slice(1), { signal: input.signal });
				return { ...result, exitCode: 0 };
			},
		},
		messages: {
			async send(input: { text: string }) {
				await writeFile(join(dir, "delivered.txt"), input.text);
				return { ok: true };
			},
		},
	} as unknown as PluginAPI;
	let scheduler = new Scheduler(api, 2);
	try {
		await scheduler.start();
		const job = (await scheduler.manage(
			{
				action: "create",
				job: {
					name: "real process",
					enabled: false,
					schedule: { kind: "every", milliseconds: 1000, anchor: new Date().toISOString(), timezone: "UTC" },
					payload: {
						kind: "command",
						command: [process.execPath, "-e", "setTimeout(()=>process.stdout.write('cron process completed'),100)"],
					},
					delivery: { to: "conv:cli:local" },
					maxRuns: 2,
				},
			},
			ctx,
			true,
		)) as { id: string };
		await expect(scheduler.manage({ action: "get", id: job.id }, { ...ctx, session: "2" }, true)).rejects.toThrow(
			"not found",
		);
		await expect(scheduler.manage({ action: "run", id: job.id }, ctx, false)).rejects.toThrow("cron_exec");
		const running = scheduler.manage({ action: "run", id: job.id }, ctx, true);
		await expect
			.poll(
				async () =>
					((await scheduler.manage({ action: "history", id: job.id }, ctx, true)) as Array<{ status: string }>)[0]
						?.status,
			)
			.toBe("running");
		await expect(scheduler.manage({ action: "run", id: job.id }, ctx, true)).rejects.toThrow("already running");
		expect(await running).toMatchObject({ status: "done", text: "cron process completed" });
		expect(await readFile(join(dir, "delivered.txt"), "utf8")).toBe("cron process completed");
		await scheduler.stop();
		scheduler = new Scheduler(api, 2);
		await scheduler.start();
		expect(await scheduler.manage({ action: "get", id: job.id }, ctx, true)).toMatchObject({ runs: 1 });
		ctx.capabilities = ["write", "message"];
		expect(
			await scheduler.manage(
				{ action: "run", id: job.id },
				{ ...ctx, capabilities: ["write", "exec", "message"] },
				true,
			),
		).toMatchObject({ status: "run-failed", error: "exec revoked" });
		expect(await readFile(join(dir, "delivered.txt"), "utf8")).toContain("exec revoked");
		ctx.capabilities = ["read", "write", "message", "admin"];
		const event = (await scheduler.manage(
			{
				action: "create",
				job: {
					name: "record event",
					enabled: false,
					schedule: { kind: "at", at: new Date(Date.now() + 60000).toISOString(), timezone: "UTC" },
					payload: { kind: "event", type: "cron.fire", target: "conv:cli:local", data: { text: "scheduled event" } },
				},
			},
			ctx,
			false,
		)) as { id: string };
		expect(await scheduler.manage({ action: "run", id: event.id }, ctx, false)).toMatchObject({ status: "done" });
		expect(events.find((e) => e.type === "cron.fire")).toMatchObject({ from: "plugin:cron", conv: "conv:cli:local" });
		const at = new Date(Date.now() + 100).toISOString();
		const pending: Array<{ id: string }> = [];
		for (const missed of ["skip", "coalesce"])
			pending.push(
				(await scheduler.manage(
					{
						action: "create",
						job: {
							name: missed,
							missed,
							maxRuns: 1,
							schedule: { kind: "at", at, timezone: "UTC" },
							payload: { kind: "event", type: "cron.recovered", target: "conv:cli:local", data: {} },
						},
					},
					ctx,
					false,
				)) as { id: string },
			);
		await scheduler.stop();
		await new Promise((resolve) => setTimeout(resolve, 130));
		scheduler = new Scheduler(api, 1);
		await scheduler.start();
		await expect
			.poll(
				async () =>
					(
						(await scheduler.manage({ action: "history", id: pending[1]?.id }, ctx, false)) as Array<{ status: string }>
					)[0]?.status,
				// Windows runners are slow enough that a fired recovery can still be running after the 1s default.
				{ timeout: 10_000 },
			)
			.toBe("done");
		expect(await scheduler.manage({ action: "history", id: pending[0]?.id }, ctx, false)).toMatchObject([
			{ status: "skipped" },
		]);
		expect(await scheduler.manage({ action: "get", id: pending[1]?.id }, ctx, false)).toMatchObject({
			runs: 1,
			enabled: false,
			next: null,
		});
		expect(events.filter((e) => e.type === "cron.recovered")).toHaveLength(1);
		ctx.capabilities = ["write", "exec", "message"];
		const long = (await scheduler.manage(
			{
				action: "create",
				job: {
					name: "stop real child",
					enabled: false,
					schedule: { kind: "every", milliseconds: 1000, anchor: new Date().toISOString(), timezone: "UTC" },
					payload: { kind: "command", command: [process.execPath, "-e", "setTimeout(()=>{},10000)"] },
				},
			},
			ctx,
			true,
		)) as { id: string };
		const longRun = scheduler.manage({ action: "run", id: long.id }, ctx, true);
		await expect
			.poll(
				async () =>
					((await scheduler.manage({ action: "history", id: long.id }, ctx, true)) as Array<{ status: string }>)[0]
						?.status,
			)
			.toBe("running");
		await scheduler.stop();
		expect(await longRun).toMatchObject({ status: "interrupted" });
		await expect(scheduler.manage({ action: "run", id: long.id }, ctx, true)).rejects.toThrow("service stopped");
	} finally {
		await scheduler.stop();
		await rm(dir, { recursive: true, force: true });
	}
});

test("Agent jobs require the owning profile and history retains the newest bounded page", async () => {
	const dir = await mkdtemp(join(tmpdir(), "yonder-cron-profile-"));
	const owner = {
		agent: "main",
		session: "1",
		profile: "owner",
		capabilities: ["write", "exec", "admin"],
	} as ToolContext;
	const lower = { ...owner, session: "2", profile: "readonly", capabilities: ["read", "write"] } as ToolContext;
	const api = {
		paths: { data: dir },
		log: { error: () => {} },
		execution: {
			async resolve(identity: { agent: string | null; profile: string; session: string }) {
				if (identity.agent !== owner.agent) throw new Error("Unknown Agent identity");
				if (identity.profile === owner.profile) return { capabilities: owner.capabilities };
				if (identity.profile === lower.profile) return { capabilities: lower.capabilities };
				throw new Error("Unknown profile identity");
			},
		},
		events: {
			async emit(input: object) {
				return { ...input, id: String(Date.now()), ts: new Date().toISOString() } as YEvent;
			},
			async ask(input: object) {
				return { event: await this.emit(input), results: [] };
			},
		},
	} as unknown as PluginAPI;
	const scheduler = new Scheduler(api);
	try {
		await scheduler.start();
		await expect(
			scheduler.manage(
				{
					action: "create",
					job: {
						name: "unprivileged raw event",
						enabled: false,
						schedule: { kind: "every", milliseconds: 1000, anchor: new Date().toISOString(), timezone: "UTC" },
						payload: { kind: "event", type: "cron.profile-check", target: "conv:cli:local", data: {} },
					},
				},
				lower,
				false,
			),
		).rejects.toThrow("admin capability required");
		expect(await scheduler.manage({ action: "list" }, lower, false)).toEqual([]);

		const job = (await scheduler.manage(
			{
				action: "create",
				job: {
					name: "profile-owned event",
					enabled: false,
					schedule: { kind: "every", milliseconds: 1000, anchor: new Date().toISOString(), timezone: "UTC" },
					payload: { kind: "event", type: "cron.profile-check", target: "conv:cli:local", data: {} },
				},
			},
			owner,
			false,
		)) as { id: string };
		await expect(scheduler.manage({ action: "enable", id: job.id }, lower, false)).rejects.toThrow("not found");
		await expect(scheduler.manage({ action: "run", id: job.id }, lower, false)).rejects.toThrow("not found");
		expect(await scheduler.manage({ action: "list" }, lower, false)).toEqual([]);
		const runs: Array<{ id: string; started: string }> = [];
		for (let i = 0; i < 7; i++) {
			runs.push(
				(await scheduler.manage({ action: "run", id: job.id }, owner, false)) as { id: string; started: string },
			);
			await new Promise((resolve) => setTimeout(resolve, 2));
		}
		const retainedSizes: number[] = [];
		const originalSort = Array.prototype.sort;
		const sort = vi.spyOn(Array.prototype, "sort").mockImplementation(function (this: unknown[], compare) {
			if ((this[0] as { job?: string } | undefined)?.job === job.id) retainedSizes.push(this.length);
			return originalSort.call(this, compare);
		});
		try {
			const latest = (await scheduler.manage(
				{ action: "history", id: job.id, limit: 2 },
				{ ...owner, session: "3" },
				false,
			)) as Array<{ id: string }>;
			expect(latest.map((run) => run.id)).toEqual(
				runs
					.slice(-2)
					.reverse()
					.map((run) => run.id),
			);
			expect(Math.max(...retainedSizes)).toBeLessThanOrEqual(3);
		} finally {
			sort.mockRestore();
		}
		expect(await scheduler.manage({ action: "history", id: job.id, limit: 1 }, owner, false)).toHaveLength(1);
	} finally {
		await scheduler.stop();
		await rm(dir, { recursive: true, force: true });
	}
});
