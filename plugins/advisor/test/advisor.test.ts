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
			"advisor_consult",
			"advisor_record_advisor_outcome",
		]);
		const [consult, record] = collector.registrations.tools;
		if (!consult || !record) throw new Error("missing tools");
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
		expect(log).not.toContain("consultation");
		const restarted = createRegistrationCollector();
		await plugin.setup({ ...api, tools: restarted.api.tools } as never);
		expect((await restarted.registrations.tools[1]?.execute(args, ctx))?.text).toContain('"recorded":false');
		const disabled = createRegistrationCollector();
		await plugin.setup({ ...api, config: {}, tools: disabled.api.tools } as never);
		expect((await disabled.registrations.tools[1]?.execute(args, ctx))?.text).toContain("disabled");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
