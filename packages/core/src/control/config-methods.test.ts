import { mkdtemp, readFile, rm } from "node:fs/promises";

import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { parse } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "../kernel/index.js";
import { releaseInfo } from "../release/index.js";
import { type HostCtx, registry } from "./methods.js";

const homes: string[] = [];
afterAll(async () => {
	for (const home of homes) await rm(home, { recursive: true, force: true });
});

const admin = {
	id: "socket",
	transport: "socket" as const,
	kind: "local",
	scopes: ["read", "write", "admin", "owner"] as HostCtx["principal"]["scopes"],
};

async function open() {
	const home = await mkdtemp("/tmp/yonder-config-methods-");
	homes.push(home);
	await initHome(home, "owner", { model: testModel });
	const kernel = await openKernel(home);
	homes.push(home);
	const ctx = {
		home,
		kernel,
		principal: admin,
		releaseInfo: () => releaseInfo(home),
		awakeStatus: () => ({}),
		stop: () => {},
	} as unknown as HostCtx;
	const call = (method: string, params: unknown) =>
		registry.call(method, params, ctx, new AbortController().signal) as Promise<Record<string, never>>;
	return { home, kernel, ctx, call };
}

it("config.get is redacted: routing, limits and social only, never a credential", async () => {
	const { kernel, call } = await open();
	try {
		const view = (await call("config.get", {})) as unknown as Record<string, unknown>;
		expect(view.agent).toBe("main");
		expect(view.model).toBe(testModel);
		expect(typeof view.revision).toBe("string");
		expect(view).toHaveProperty("limits");
		expect(view).toHaveProperty("social");
		// 脱敏：任何凭据/密钥/提供方块都不出现在读视图里。
		const json = JSON.stringify(view);
		expect(json).not.toMatch(/apiKey|api_key|secret|credential|"sk-/i);
		expect(view).not.toHaveProperty("models.providers");
	} finally {
		await kernel.close();
	}
});

it("config.update writes agent.yaml atomically, reloads, audits and shows up in the next read", async () => {
	const { home, kernel, call } = await open();
	try {
		const before = (await call("config.get", {})) as unknown as { revision: string };
		await expect(
			call("config.update", { expectedRevision: "stale", patch: { limits: { maxTokens: 4096 } } }),
		).rejects.toMatchObject({ code: "conflict" });
		await expect(
			call("config.update", { expectedRevision: before.revision, patch: { nope: true } }),
		).rejects.toMatchObject({ code: "invalid_params" });
		await expect(call("config.update", { expectedRevision: before.revision, patch: {} })).rejects.toMatchObject({
			code: "invalid_params",
		});

		const updated = (await call("config.update", {
			expectedRevision: before.revision,
			patch: { model: testModel, limits: { maxTokens: 4096 }, social: { enabled: false } },
		})) as unknown as { applied: string[]; restartRequired: boolean; limits: { maxTokens: number } };
		expect(updated.applied).toEqual(["model", "limits", "social"]);
		expect(updated.restartRequired).toBe(false);
		expect(updated.limits.maxTokens).toBe(4096);

		const agent = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8")) as {
			profiles: Record<string, { limits?: { maxTokens?: number } }>;
			social?: { enabled?: boolean };
		};
		expect(agent.profiles.owner?.limits?.maxTokens).toBe(4096);
		expect(agent.social?.enabled).toBe(false);

		const after = (await call("config.get", {})) as unknown as { revision: string; limits: { maxTokens: number } };
		expect(after.limits.maxTokens).toBe(4096);
		expect(after.revision).not.toBe(before.revision);

		const audit = await kernel.events.query({ type: "config.change" });
		expect(audit.events).toHaveLength(1);
		expect(audit.events[0]?.data).toMatchObject({ actor: "socket", scope: "agent", agent: "main" });
	} finally {
		await kernel.close();
	}
});

it("config.update home scope rewrites yonder.yaml quotas and asks for a restart", async () => {
	const { home, kernel, call } = await open();
	try {
		const before = (await call("config.get", {})) as unknown as { home: { revision: string } };
		const updated = (await call("config.update", {
			scope: "home",
			expectedRevision: before.home.revision,
			patch: { model: testModel, outsiders: { guestMaxRounds: 7 } },
		})) as unknown as { restartRequired: boolean; home: { outsiders: { guestMaxRounds: number } } };
		expect(updated.restartRequired).toBe(true);
		expect(updated.home.outsiders.guestMaxRounds).toBe(7);
		const yaml = parse(await readFile(join(home, "yonder.yaml"), "utf8")) as {
			outsiders?: { guestMaxRounds?: number };
			defaultModel?: string;
		};
		expect(yaml.outsiders?.guestMaxRounds).toBe(7);
		expect(yaml.defaultModel).toBe(testModel);
	} finally {
		await kernel.close();
	}
});
