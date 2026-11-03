import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { FileCredentials } from "../runtime/credentials.js";
import { openDatabase } from "../runtime/db.js";
import { localEnvironment, workspaceFiles } from "../runtime/env.js";
import { buildModels } from "../runtime/models.js";
import { createStore } from "../store/index.js";
import { createConversationTools } from "../tools/conversation.js";
import { type PromptOptions, prepareInput } from "./index.js";

test("received attachment references lead to the offered scoped reader without opening the workspace", async () => {
	const home = await tempHome("yonder-attachment-access-");
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const event = await store.events.record({
			type: "message.in",
			from: "acct:qq:owner",
			conv: "conv:qq:group:work",
			data: {
				kind: "group",
				text: "Read the received document",
				attachments: [
					{ kind: "file", mime: "text/plain", name: "received.txt", uri: "https://example.invalid/received" },
				],
			},
		});
		await mkdir(join(home, ".yonder/attachments"), { recursive: true });
		await writeFile(join(home, ".yonder/attachments", `${event.id}-0`), "received content");
		const env = localEnvironment(join(home, "workspace"));
		const row = {
			id: "1",
			agent: "main",
			profile: "group",
			mode: "persistent" as const,
			key: "group",
			version: "0.3.26110110",
			opened: event.ts,
		};
		const session = {
			agent: row.agent,
			profile: row.profile,
			cwd: join(home, "workspace"),
			resolved: resolveProfile({ level: "readonly" }),
		};
		const options: PromptOptions = {
			home,
			version: row.version,
			locale: "zh-CN",
			timezone: "Asia/Shanghai",
			contexts: new Map(),
			workspace: () => workspaceFiles(env),
			identity: store.identity(),
			models: buildModels(new FileCredentials(join(home, "auth.json"))),
			setVersion: store.sessions.setVersion,
			offeredTools: () => ["conversation_attachment_read"],
		};
		const prepared = await prepareInput(row, session, event, "run", options);
		expect(prepared.text).toContain(`message=${event.id} index=0`);
		expect(prepared.text).toContain(`use conversation_attachment_read with message="${event.id}" and attachment=0`);
		// One shared access sentence per turn, not one per attachment.
		expect(prepared.text.match(/attachment access: /gu)).toHaveLength(1);
		const reader = createConversationTools(store, home).find((tool) => tool.name === "conversation_attachment_read");
		if (!reader) throw new Error("Scoped attachment reader is missing");
		const ctx: ToolContext = {
			agent: row.agent,
			profile: row.profile,
			session: row.id,
			capabilities: ["read"],
			env,
			event,
			signal: new AbortController().signal,
		};
		expect(JSON.parse((await reader.execute({ message: event.id, attachment: 0 }, ctx)).text).text).toBe(
			"received content",
		);
		expect((await reader.execute({ message: event.id, attachment: 0 }, { ...ctx, capabilities: [] })).isError).toBe(
			true,
		);
		const unavailable = await prepareInput(row, session, event, "run", { ...options, offeredTools: () => ["read"] });
		expect(unavailable.text).toContain("conversation_attachment_read is not offered in this profile");
		expect(unavailable.text).not.toContain("use conversation_attachment_read with");
		const foreign = { ...ctx, event: { ...event, conv: "conv:qq:group:other" } };
		expect((await reader.execute({ message: event.id, attachment: 0 }, foreign)).isError).toBe(true);
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
