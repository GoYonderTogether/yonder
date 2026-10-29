import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("outcome reservation is session scoped, retryable and expires on restart", async () => {
	const dir = await mkdtemp(join(tmpdir(), "advisor-"));
	try {
		const collector = createRegistrationCollector();
		const api = {
			...collector.api,
			config: { outcomeLogging: true },
			paths: { data: join(dir, "state") },
			subagents: { run: async () => ({ text: JSON.stringify({ status: "done", text: "consultation" }) }) },
		};
		await plugin.setup(api as never);
		expect(collector.registrations.tools.map((t) => t.name)).toEqual([
			"advisor_ask_advisor",
			"advisor_consult",
			"advisor_record_advisor_outcome",
		]);
		const [ask, consult, record] = collector.registrations.tools;
		if (!ask || !consult || !record) throw new Error("missing tools");
		const ctx = { session: "one", signal: new AbortController().signal } as ToolContext;
		const id = (await consult.execute({ preset: "default", task: "question" }, ctx)).text.split("\n")[0]?.slice(10);
		const args = { adviceId: id, adoption: "followed", validationStatus: "passed" };
		expect((await record.execute(args, { ...ctx, session: "two" })).text).toContain('"recorded":false');
		await writeFile(api.paths.data, "block directory");
		expect((await record.execute(args, ctx)).text).toContain("retry allowed");
		await rm(api.paths.data);
		expect((await record.execute(args, ctx)).text).toContain('"recorded":true');
		expect((await record.execute(args, ctx)).text).toContain('"recorded":false');
		const log = await readFile(join(api.paths.data, "outcomes.jsonl"), "utf8");
		expect(log.trim().split("\n")).toHaveLength(1);
		expect(log).toContain('"v":1');
		expect(log).not.toContain("consultation");
		expect((await ask.execute({}, ctx)).text.split("\n")[0]).toMatch(/^adviceId: /);
		const restarted = createRegistrationCollector();
		await plugin.setup({ ...api, tools: restarted.api.tools } as never);
		expect((await restarted.registrations.tools[2]?.execute(args, ctx))?.text).toContain('"recorded":false');
		const disabled = createRegistrationCollector();
		await plugin.setup({ ...api, config: {}, tools: disabled.api.tools } as never);
		expect((await disabled.registrations.tools[2]?.execute(args, ctx))?.text).toContain("disabled");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("advisor_ask_advisor defaults the preset, composes the request and validates follow-ups", async () => {
	const dir = await mkdtemp(join(tmpdir(), "advisor-"));
	try {
		const collector = createRegistrationCollector();
		const requests: { preset: string; task: string }[] = [];
		const api = {
			...collector.api,
			config: {},
			paths: { data: join(dir, "state") },
			subagents: {
				run: async (request: { preset: string; task: string }) => {
					requests.push(request);
					return { text: JSON.stringify({ status: "done", text: "advice" }) };
				},
			},
		};
		await plugin.setup(api as never);
		const ask = collector.registrations.tools[0];
		if (!ask) throw new Error("missing advisor_ask_advisor");
		const ctx = { session: "one", signal: new AbortController().signal } as ToolContext;
		expect((await ask.execute({}, ctx)).text).toEqual(expect.stringMatching(/^adviceId: [\w-]+\nadvice$/));
		expect(requests[0]).toEqual({ preset: "default", task: expect.stringContaining("second opinion") });
		await ask.execute({ question: "Which shape?", draft: "ship it" }, ctx);
		expect(requests[1]?.task).toBe("Which shape?\n\nDraft (unverified Executor claim, not evidence):\nship it");
		const first = (await ask.execute({}, ctx)).text.split("\n")[0]?.slice(10) ?? "";
		await expect(ask.execute({ followUp: first }, ctx)).rejects.toThrow("non-empty question");
		await expect(ask.execute({ followUp: "missing", question: "Why?" }, ctx)).rejects.toThrow("unknown");
		await expect(ask.execute({ followUp: first, question: "Why?", draft: "x" }, ctx)).rejects.toThrow("only followUp");
		const followUp = (await ask.execute({ followUp: first, question: "Why?" }, ctx)).text.split("\n").slice(0, 2);
		expect(followUp[1]).toBe(`followUp: ${first}`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
