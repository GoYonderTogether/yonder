import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { matches, sessionKey } from "@yonder/bot-core/routing/matching";
import { initHome } from "@yonder/local-host/kernel/home";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import type { YEvent } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { parseAgentConfig } from "../../../packages/local-host/src/config/index.js";
import { upgradeGroups } from "../src/setup.js";

test("explicit card upgrade adds isolated read-only group route once and preserves custom bindings", async () => {
	const home = await tempHome("card-groups-");
	try {
		await initHome(home, "owner", { model: "openai/gpt-6-luna" });
		const file = join(home, "agents/main/agent.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.bindings = config.bindings.filter((b: { id: string }) => b.id !== "card-group");
		delete config.profiles["card-group"];
		await writeFile(file, stringify(config));
		const first = await upgradeGroups(home);
		expect(first.changed).toHaveLength(1);
		expect(await readFile(first.changed[0].backup, "utf8")).toBe(stringify(config));
		const agent = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		const binding = agent.bindings.find((b) => b.id === "card-group")!;
		expect(binding).toMatchObject({ wake: "mention", reply: "none", busy: "steer", profile: "card-group" });
		expect(agent.profiles["card-group"]).toMatchObject({
			capabilities: ["read"],
			plugins: [],
			skills: [],
			contexts: ["peer-workspace"],
			tools: {
				offer: expect.arrayContaining([
					"conversation_read",
					"conversation_members",
					"conversation_attachment_read",
					"message_send",
					"parent_ask",
				]),
			},
		});
		const event = {
			id: "event",
			ts: new Date().toISOString(),
			type: "message.in",
			from: "acct:card:main:person",
			conv: "conv:card:main:group",
			data: { kind: "group", target: "main", text: "明确提问", mentioned: true },
		} as YEvent;
		const db = await openDatabase(join(home, ".yonder/state.db"));
		try {
			expect(await matches(binding, event, agent, await createStore(db))).toBe(true);
		} finally {
			db.close();
		}
		expect(sessionKey(binding, event)).toEqual({ mode: "persistent", key: "conv:conv:card:main:group" });
		expect((await upgradeGroups(home)).changed).toEqual([]);
		const saved = await readFile(file, "utf8");
		const custom = parse(saved);
		custom.bindings.find((b: { id: string }) => b.id === "card-group").profile = "readonly";
		await writeFile(file, stringify(custom));
		expect((await upgradeGroups(home)).changed).toEqual([]);
		expect(await readFile(file, "utf8")).toBe(stringify(custom));
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
