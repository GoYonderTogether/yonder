import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { Scheduler } from "./index.js";

async function setup() {
	await mkdir(".yonder", { recursive: true });
	const home = await mkdtemp(join(process.cwd(), ".yonder/cron-scope-"));
	const ctx = {
		agent: "scope-a",
		session: "1",
		profile: "owner",
		capabilities: ["read", "write", "exec", "message", "admin"],
		channelInstances: ["a"],
	} as ToolContext;
	const authority = { capabilities: [...ctx.capabilities], channelInstances: ["a"] };
	const resolve = vi.fn(async () => structuredClone(authority));
	const run = vi.fn(async () => ({ stdout: "protocol command result", stderr: "", exitCode: 0 }));
	const send = vi.fn(async () => ({ ok: true }));
	const api = {
		paths: { data: home },
		execution: { resolve, run },
		messages: { send },
		events: { emit: vi.fn(async () => ({ id: "event" })) },
		log: { error: vi.fn() },
	} as unknown as PluginAPI;
	const scheduler = new Scheduler(api);
	await scheduler.start();
	const job = (instance: string) => ({
		name: "Scope regression",
		enabled: false,
		schedule: { kind: "at", at: new Date(Date.now() + 60000).toISOString(), timezone: "Asia/Shanghai" },
		payload: { kind: "command", command: "printf protocol" },
		delivery: { to: `conv:${instance}:chat`, via: instance },
	});
	return {
		scheduler,
		ctx,
		authority,
		resolve,
		run,
		send,
		job,
		close: async () => {
			await scheduler.stop();
			await rm(home, { recursive: true, force: true });
		},
	};
}

test("cron validates create/update against ctx and true owner; legal delivery carries real owner, never fake ctx", async () => {
	const x = await setup();
	try {
		await expect(x.scheduler.manage({ action: "create", job: x.job("b") }, x.ctx, true)).rejects.toThrow(
			"not authorized",
		);
		expect(x.run).not.toHaveBeenCalled();
		expect(x.send).not.toHaveBeenCalled();
		const job = (await x.scheduler.manage({ action: "create", job: x.job("a") }, x.ctx, true)) as {
			id: string;
			owner: object;
		};
		await expect(
			x.scheduler.manage({ action: "update", id: job.id, job: { delivery: { to: "conv:b:chat" } } }, x.ctx, true),
		).rejects.toThrow("not authorized");
		await expect(
			x.scheduler.manage(
				{ action: "update", id: job.id, job: { delivery: { to: "conv:a:chat", via: "b" } } },
				x.ctx,
				true,
			),
		).rejects.toThrow("does not match");
		expect(await x.scheduler.manage({ action: "run", id: job.id }, x.ctx, true)).toMatchObject({ status: "done" });
		expect(x.run).toHaveBeenCalledTimes(1);
		expect(x.send).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ owner: { agent: "scope-a", session: "1", profile: "owner" }, via: "a" }),
		);
		for (const call of x.resolve.mock.calls) expect(call).toEqual([job.owner]);
		// A caller's wider/stale claim is not the authoritative owner's current grant.
		x.authority.channelInstances = [];
		await expect(
			x.scheduler.manage({ action: "update", id: job.id, job: { delivery: { to: "conv:a:chat" } } }, x.ctx, true),
		).rejects.toThrow("not authorized");
		expect(await x.scheduler.manage({ action: "run", id: job.id }, x.ctx, true)).toMatchObject({
			status: "delivery-failed",
			error: expect.stringContaining("not authorized"),
			deliveryError: expect.stringContaining("not authorized"),
		});
		expect(x.run).toHaveBeenCalledTimes(1);
		expect(x.send).toHaveBeenCalledTimes(1);
	} finally {
		await x.close();
	}
});

test("revocation during command blocks the final notification; current message capability is still required", async () => {
	const x = await setup();
	try {
		const job = (await x.scheduler.manage({ action: "create", job: x.job("a") }, x.ctx, true)) as { id: string };
		x.run.mockImplementationOnce(async () => {
			x.authority.channelInstances = [];
			return { stdout: "done", stderr: "", exitCode: 0 };
		});
		expect(await x.scheduler.manage({ action: "run", id: job.id }, x.ctx, true)).toMatchObject({
			status: "delivery-failed",
			deliveryError: expect.stringContaining("not authorized"),
		});
		expect(x.send).not.toHaveBeenCalled();
		x.authority.channelInstances = ["a"];
		x.authority.capabilities = ["read", "exec"];
		expect(await x.scheduler.manage({ action: "run", id: job.id }, x.ctx, true)).toMatchObject({
			status: "delivery-failed",
			error: expect.stringContaining("message capability revoked"),
		});
		expect(x.run).toHaveBeenCalledTimes(1);
		expect(x.send).not.toHaveBeenCalled();
	} finally {
		await x.close();
	}
});
