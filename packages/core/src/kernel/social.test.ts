import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parseAgentConfig, type YonderConfig } from "../config/index.js";
import { createSocial } from "./social.js";

test("owner confirmation gates policy change, persists it, and records rejection and application", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-social-policy-"));
	try {
		const file = join(home, "agent.yaml");
		const raw = JSON.stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: { default: {} },
			bindings: [],
			social: {
				enabled: true,
				authorized: { conversations: ["conv:test:group"] },
				defaults: { group: { mode: "batch" } },
			},
		});
		await writeFile(file, raw);
		await writeFile(join(home, "yonder.yaml"), "{}");
		const agents = new Map([["main", parseAgentConfig(raw)]]);
		const events: Array<{ data: object }> = [];
		const service = createSocial({
			home,
			config: { agents: [{ id: "main", workspace: "." }] } as YonderConfig,
			agents,
			assert: () => {},
			owner: async () => true,
			target: async () => ({ kind: "group" }),
			record: async (event) => {
				events.push(event);
			},
			validate: async () => {},
			reload: async () => {
				agents.set("main", parseAgentConfig(await readFile(file, "utf8")));
			},
		});
		const ctx = {
			agent: "main",
			session: "s",
			profile: "default",
			capabilities: ["read", "admin"],
			channelInstances: ["test"],
			event: {
				id: "one",
				type: "message.in",
				from: "acct:console:owner",
				conv: "conv:console:main",
				data: { kind: "dm", text: "change group" },
			},
		} as unknown as ToolContext;
		const initial = await service.inspect({ agent: "main", conv: "conv:test:group" }, ctx);
		const request = {
			agent: "main",
			conv: "conv:test:group",
			expectedRevision: initial.revision,
			patch: { mode: "mention" as const },
			reason: "owner request",
		};
		await service.update(request, ctx);
		await expect(service.update({ ...request, dryRun: false }, ctx)).rejects.toThrow("separate message");
		await service.update(request, ctx);
		const confirmed = { ...ctx, event: { ...ctx.event!, id: "two", data: { kind: "dm", text: "确认" } } };
		await service.update({ ...request, dryRun: false }, confirmed);
		expect(parseAgentConfig(await readFile(file, "utf8")).social?.conversations?.[request.conv]?.mode).toBe("mention");
		expect(events.map((e) => (e.data as { result: string }).result)).toEqual(["rejected", "applied"]);
		await expect(service.update({ ...request, dryRun: false }, confirmed)).rejects.toThrow();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
