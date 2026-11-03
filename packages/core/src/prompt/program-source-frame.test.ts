import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { conversationPromptOptions } from "../kernel/conversation.js";
import { FileCredentials } from "../runtime/credentials.js";
import { openDatabase } from "../runtime/db.js";
import { localEnvironment, workspaceFiles } from "../runtime/env.js";
import type { Runtime } from "../runtime/index.js";
import { buildModels } from "../runtime/models.js";
import { createStore } from "../store/index.js";
import { type PromptOptions, prepareInput } from "./index.js";

test("prepared program inputs show only their verified source and preserve body once", async () => {
	const home = await tempHome("yonder-program-source-frame-");
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const session = {
			id: "155",
			agent: "target",
			profile: "group",
			mode: "persistent" as const,
			key: "conv:qq:group:source-frame",
			version: "test",
			opened: new Date().toISOString(),
		};
		await store.sessions.put(session);
		const route = [{ agent: "target", session: session.id, binding: "source", wake: "write" as const }];
		const source = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:owner",
				conv: session.key,
				data: { kind: "group", text: "FIRST OWNER BODY" },
			},
			route,
		);
		const result = await store.events.record(
			{
				type: "runtime.tool-result",
				parent: source.id,
				conv: session.key,
				data: { session: session.id, job: "job-1", text: "PROGRAM REPORT" },
			},
			[{ agent: "target", session: session.id, binding: "background", wake: "run" }],
		);
		const later = await store.events.record(
			{
				type: "message.in",
				from: "acct:qq:owner",
				conv: session.key,
				data: { kind: "group", text: "LATER OWNER BODY" },
			},
			route,
		);
		const runtime = { describeTools: () => [] } as unknown as Runtime;
		const host = conversationPromptOptions(store, new Map(), () => runtime);
		const options: PromptOptions = {
			home,
			version: "test",
			locale: "en-US",
			timezone: "UTC",
			contexts: new Map(),
			workspace: () => workspaceFiles(localEnvironment(home)),
			identity: store.identity(),
			models: buildModels(new FileCredentials(join(home, "auth.json"))),
			setVersion: store.sessions.setVersion,
			...host,
		};
		const row = session;
		const profile = { agent: "target", profile: "group", cwd: home, resolved: resolveProfile({}) };
		const prepared = await prepareInput(row, profile, result, "run", options);
		expect(prepared.text).toContain(
			`program-input: {"role":"program-result","sources":{"status":"verified","limit":8,"total":1,"omitted":0,"items":[{"id":"${source.id}","conv":"${session.key}"}]}}`,
		);
		expect(prepared.text).not.toContain(later.id);
		expect(prepared.text).not.toContain("FIRST OWNER BODY");
		expect(prepared.text).not.toContain("LATER OWNER BODY");
		expect(prepared.text.match(/PROGRAM REPORT/g)).toHaveLength(1);

		const continuation = await store.events.record(
			{
				type: "runtime.continuation",
				parent: source.id,
				conv: session.key,
				data: { session: session.id, job: "job-2", text: "CONTINUATION BODY" },
			},
			[{ agent: "target", session: session.id, binding: "continuation", wake: "run" }],
		);
		const continued = await prepareInput(row, profile, continuation, "run", options);
		expect(continued.text).toContain('"role":"continuation"');
		expect(continued.text).toContain(source.id);
		expect(continued.text).not.toContain(later.id);
		expect(continued.text.match(/CONTINUATION BODY/g)).toHaveLength(1);
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
