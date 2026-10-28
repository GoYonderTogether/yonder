import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { openKernel } from "./index.js";

test("real kernel validates program owner, keeps plugin notifications and persists task ceilings without a model", async () => {
	await mkdir(".yonder", { recursive: true });
	const home = await mkdtemp(join(process.cwd(), ".yonder/channel-scope-"));
	const key = `scope-probe-${home}`;
	const global = globalThis as unknown as Record<
		string,
		{ api: PluginAPI; sent: Array<{ instance: string; to: string }> }
	>;
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	const presetFile = join(home, "presets/actor.yaml");
	const writeActor = (scope?: string[], capabilities = ["read", "message"]) =>
		writeFile(
			presetFile,
			stringify({
				schema: 1,
				description: "Program scope regression",
				capabilities,
				...(scope === undefined ? {} : { channelInstances: scope }),
			}),
		);
	try {
		await mkdir(join(home, "probe"));
		await mkdir(join(home, "presets"));
		await writeFile(
			join(home, "probe/package.json"),
			JSON.stringify({
				name: "scope-probe",
				version: "1.0.0",
				type: "module",
				yonder: { apiVersion: 1, id: "scope-probe", entry: "index.mjs", contributes: { channels: ["scope-protocol"] } },
			}),
		);
		// Only channel transport is mocked. Owner resolution, send routing, native session storage and restore are real.
		await writeFile(
			join(home, "probe/index.mjs"),
			`
export default {
  setup(api) {
    const state = { api, sent: [] };
    globalThis[${JSON.stringify(key)}] = state;
    api.channels.register({
      type: 'scope-protocol',
      create(id) {
        return {
          id, kinds: ['dm'], output: { stream: false, attachments: false },
          async start() {}, async stop() {},
          async send(to) { state.sent.push({ instance: id, to }); return { ok: true }; }
        };
      }
    });
  }
};`,
		);
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				defaultModel: "openai/gpt-6-luna",
				plugins: [{ use: "./probe" }],
				channels: { a: { type: "scope-protocol" }, b: { type: "scope-protocol" } },
				agents: [],
			}),
		);
		await writeActor(["a"]);
		for (const [id, scope] of [
			["multi", ["a", "b"]],
			["other", ["b"]],
			["empty", []],
		] as const)
			await writeFile(
				join(home, `presets/${id}.yaml`),
				stringify({ schema: 1, description: "Child scope regression", channelInstances: scope }),
			);
		kernel = await openKernel(home);
		let probe = global[key]!;
		const parent = await kernel.sessions.open({ preset: "actor", close: "manual" });
		const owner = { session: parent.id, agent: null, profile: "actor" };
		expect(await probe.api.execution.resolve(owner)).toEqual({
			capabilities: ["read", "message"],
			channelInstances: ["a"],
		});
		const child = await kernel.sessions.open({ preset: "multi", parent: parent.id, close: "manual" });
		const other = await kernel.sessions.open({ preset: "other", parent: parent.id, close: "manual" });
		const empty = await kernel.sessions.open({ preset: "empty", close: "manual" });
		for (const [session, scope] of [
			[child, ["a"]],
			[other, []],
			[empty, []],
		] as const)
			expect(
				(await probe.api.execution.resolve({ session: session.id, agent: null, profile: session.profile }))
					.channelInstances,
			).toEqual(scope);
		expect(await probe.api.messages.send({ owner, to: "conv:b:chat", text: "denied" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("not authorized"),
		});
		expect(
			await probe.api.messages.send({ owner: { ...owner, profile: "multi" }, to: "conv:a:chat", text: "mismatch" }),
		).toMatchObject({ ok: false, error: expect.stringContaining("does not match") });
		// Negative protocol context only: disallowed scope is rejected by the actual API before any platform access.
		const ctx = {
			...owner,
			capabilities: ["read", "message", "admin"],
			channelInstances: ["a"],
			signal: new AbortController().signal,
		} as ToolContext;
		expect(await probe.api.messages.send({ to: "conv:b:chat", text: "ctx scope" }, ctx)).toMatchObject({
			ok: false,
			error: expect.stringContaining("not authorized"),
		});
		// Context takes priority over an owner parameter; it cannot switch to an unrestricted plugin send.
		expect(
			await probe.api.messages.send(
				{ owner: { ...owner, profile: "multi" }, to: "conv:b:chat", text: "ctx still restricts owner send" },
				ctx,
			),
		).toMatchObject({ ok: false, error: expect.stringContaining("not authorized") });
		expect(probe.sent).toEqual([]);
		expect(
			await probe.api.messages.send({ owner, to: "conv:a:chat", text: "authorized no-event program notification" }),
		).toMatchObject({ ok: true });
		expect(await probe.api.messages.send({ to: "conv:b:chat", text: "plugin's own notification" })).toMatchObject({
			ok: true,
		});
		expect(probe.sent.map((s) => s.instance)).toEqual(["a", "b"]);
		// Resolve current config on each program send; a valid owner cannot carry a stale grant.
		await writeActor([]);
		await expect
			.poll(async () => (await probe.api.execution.resolve(owner)).channelInstances, { timeout: 5000 })
			.toEqual([]);
		expect(await probe.api.messages.send({ owner, to: "conv:a:chat", text: "revoked" })).toMatchObject({ ok: false });
		expect(probe.sent).toHaveLength(2);
		await writeActor(["a"], ["read"]);
		await expect
			.poll(async () => (await probe.api.execution.resolve(owner)).capabilities, { timeout: 5000 })
			.toEqual(["read"]);
		expect(await probe.api.messages.send({ owner, to: "conv:a:chat", text: "message revoked" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("message"),
		});
		await kernel.close();
		kernel = undefined;
		// Remove all preset restrictions before restart: captured A and [] ceilings must still survive.
		await writeActor();
		for (const id of ["multi", "other", "empty"])
			await writeFile(
				join(home, `presets/${id}.yaml`),
				stringify({ schema: 1, description: "Reloaded broader preset" }),
			);
		kernel = await openKernel(home);
		probe = global[key]!;
		for (const [session, scope] of [
			[parent, ["a"]],
			[child, ["a"]],
			[other, []],
			[empty, []],
		] as const)
			expect(
				(await probe.api.execution.resolve({ session: session.id, agent: null, profile: session.profile }))
					.channelInstances,
			).toEqual(scope);
		const denied = await probe.api.messages.send({
			owner: { session: other.id, agent: null, profile: other.profile },
			to: "conv:b:chat",
			text: "must remain empty after restore",
		});
		expect(denied).toMatchObject({ ok: false });
		expect(probe.sent).toEqual([]);
	} finally {
		await kernel?.close();
		delete global[key];
		await rm(home, { recursive: true, force: true });
	}
});
