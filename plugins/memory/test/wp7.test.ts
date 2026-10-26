import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerContexts } from "../src/contexts.js";

const roots: string[] = [];
afterEach(async () => {
	vi.useRealTimers();
	const { rm } = await import("node:fs/promises");
	await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe("memory contexts identity boundary", () => {
	it("keeps private facts out and only renders the weekly context for the configured owner", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
		const root = await mkdtemp(join(tmpdir(), "memory-wp7-"));
		roots.push(root);
		await mkdir(join(root, "me"));
		await mkdir(join(root, "timeline"));
		await mkdir(join(root, "private"));
		await writeFile(join(root, "me/now.md"), "safe current fact");
		await writeFile(join(root, "me/profile.md"), "---\nprivate: true\n---\nSECRET");
		await writeFile(join(root, "timeline/2026-W43.md"), "## 本周计划\n- [ ] task\n");
		await writeFile(join(root, "private/2026-10.md"), "SECRET");
		const contexts: any[] = [];
		const api: any = {
			contexts: { register: (c: any) => contexts.push(c) },
			identity: {
				account: async (ref: string) =>
					ref === "acct:owner" ? { person: "person:owner" } : { person: "person:other" },
			},
		};
		registerContexts(api, {
			root,
			owner: "person:owner",
			timezone: "UTC",
			allowedAgents: ["agent:test"],
			allowedSourceConversations: ["conv:approved"],
		} as any);
		const workspace = { read: async () => undefined };
		const core = await contexts
			.find((c) => c.id === "memory-core")
			.render({
				workspace,
				agent: "agent:test",
				event: { type: "message.in", from: "acct:owner", conv: "conv:approved" },
			});
		expect(core).toContain("safe current fact");
		expect(core).not.toContain("SECRET");
		const week = contexts.find((c) => c.id === "memory-week");
		expect(
			await week.render({
				workspace,
				agent: "agent:test",
				event: { type: "message.in", from: "acct:other", conv: "conv:approved" },
			}),
		).toBeUndefined();
		expect(
			await week.render({
				workspace,
				agent: "agent:test",
				event: { type: "message.in", from: "acct:owner", conv: "conv:approved" },
			}),
		).toContain("task");
		expect(await week.render({ workspace })).toBeUndefined();
		expect(
			await week.render({
				workspace,
				agent: "agent:test",
				event: { type: "message.in", from: "acct:owner", conv: "conv:unapproved" },
			}),
		).toBeUndefined();
		expect(
			await week.render({
				workspace,
				agent: "agent:other",
				event: { type: "message.in", from: "acct:owner", conv: "conv:approved" },
			}),
		).toBeUndefined();
		expect(
			await week.render({ workspace, agent: "agent:test", event: { type: "message.in", from: "acct:owner" } }),
		).toBeUndefined();
	});
});
