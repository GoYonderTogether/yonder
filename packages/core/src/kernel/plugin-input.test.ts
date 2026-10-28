import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("plugin reminders reach resident sessions, queue followups and preserve task submission", async () => {
	const home = await mkdtemp("/tmp/yonder-plugin-input-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "input-test", { model: testModel, isolated: true });
		await rm(join(home, "presets"), { recursive: true });
		await writeFile(
			join(home, "package.json"),
			JSON.stringify({
				type: "module",
				version: "1.0.0",
				yonder: {
					apiVersion: 1,
					id: "x",
					entry: "./probe.mjs",
					contributes: { hooks: ["hold"], presets: ["input-task"] },
				},
			}),
		);
		// Hold a real request before the provider call, then cancel it. No model substitute.
		await writeFile(
			join(home, "probe.mjs"),
			`export let api;
export const requests = [];
export default { setup(value) {
  api = value;
  api.presets.register({ id: "input-task", description: "Submission protocol test", model: "openai/gpt-6-luna", capabilities: ["read"], plugins: ["x"], contexts: [], tools: {offer: [], search: []} });
  api.hooks.register({ id: 'hold', async beforeRequest(messages, ctx) {
    requests.push({ messages, ctx });
    await new Promise(resolve => ctx.signal.aborted ? resolve() : ctx.signal.addEventListener('abort', resolve, {once:true}));
  }});
}};`,
		);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		config.plugins = [{ use: home }];
		config.channels = {};
		await writeFile(join(home, "yonder.yaml"), stringify(config));
		await writeFile(
			join(home, "agents/main/agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "Input protocol test",
				owner: "person:input-test",
				defaultProfile: "owner",
				profiles: {
					owner: {
						model: "openai/gpt-6-luna",
						capabilities: ["read"],
						plugins: ["x"],
						contexts: [],
						tools: { offer: [], search: [] },
					},
				},
				bindings: [
					{ id: "main", match: { type: "x.main" }, session: "main", wake: "write" },
					{
						id: "persistent",
						match: { type: "x.persistent" },
						session: { mode: "persistent", per: "conv" },
						wake: "write",
					},
				],
			}),
		);
		kernel = await openKernel(home, { log() {} });
		const running = kernel;
		const probe = (await import(pathToFileURL(join(home, "probe.mjs")).href)) as {
			api: PluginAPI;
			requests: Array<{ messages: unknown[]; ctx: ToolContext }>;
		};
		for (const mode of ["main", "persistent"]) {
			const routed = await probe.api.events.emit({ type: `x.${mode}`, conv: "conv:test:room", data: {} });
			const id = routed.routes![0]!.session!;
			await expect(kernel.sessions.submit(id, { text: "direct submit stays task-only" })).rejects.toThrow(
				"Not an open task",
			);
			const count = probe.requests.length;
			const receipt = await probe.api.sessions.submit(id, { text: "Inspect stalled work" }, { wait: false });
			await expect.poll(() => probe.requests.length).toBe(count + 1);
			const request = probe.requests.at(-1)!;
			expect(request.ctx).toMatchObject({ agent: "main", session: id, profile: "owner", capabilities: ["read"] });
			expect(request.ctx.event).toMatchObject({ id: receipt.event, type: "session.input", from: "plugin:x" });
			expect(request.ctx.event?.parent).toBeUndefined();
			expect(JSON.stringify(request.messages)).toContain("System reminder; no human authority");
			const queued = await probe.api.sessions.submit(id, { text: "Next reminder" }, { busy: "followup" });
			await expect
				.poll(async () => (await running.terminal.queued(id)).map((entry) => entry.event))
				.toEqual([queued.event]);
			expect(probe.requests).toHaveLength(count + 1);
			const inputs = (await kernel.events.query({ type: "session.input", from: "plugin:x" })).events;
			expect(inputs.find((event) => event.id === queued.event)?.data).toMatchObject({ session: id, busy: "followup" });
			await kernel.sessions.close(id);
			await expect(probe.api.sessions.submit(id, { text: "closed" })).rejects.toThrow("Not an open task");
		}
		await expect(probe.api.sessions.submit("unknown", { text: "missing" })).rejects.toThrow("Not an open task");
		const task = await kernel.sessions.open({ preset: "input-task", close: "manual" });
		const count = probe.requests.length;
		await probe.api.sessions.submit(task.id, { text: "Task input" });
		// Cancel at the real hook before a provider call.
		await expect.poll(() => probe.requests.length).toBe(count + 1);
		await kernel.sessions.abort(task.id);
		expect((await kernel.sessions.get(task.id))?.closed).toBeUndefined();
		expect((await kernel.events.query({ type: "session.input", from: "plugin:x" })).events.at(-1)?.data).toMatchObject({
			session: task.id,
		});
		expect(probe.requests.at(-1)?.ctx.agent).toBeNull();
		await kernel.close();
		kernel = await openKernel(home, { log() {} });
		expect((await kernel.events.query({ type: "session.input", from: "plugin:x" })).events).toHaveLength(5);
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
