import { rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Binding } from "@yonder/bot-definition";
import { resolveProfile } from "@yonder/local-host/config/test-support";
import { newEvent } from "@yonder/local-host/store/index";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db";
import { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import { autoReplySource } from "@yonder/runtime-adapter/runtime/lifecycle";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { YEvent } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("ToolContext exposes a source only while its frozen native run remains current", async () => {
	const home = await tempHome("yonder-tool-context-source-");
	let runtime: Runtime | undefined;
	try {
		const bindings: Binding[] = [
			{ id: "web-auto", match: { channel: "web" }, session: "main", reply: "auto" },
			{ id: "console-auto", match: { channel: "console" }, session: "main", reply: "auto" },
			{ id: "web-none", match: { channel: "web" }, session: "main", reply: "none" },
		];
		runtime = await Runtime.open({
			home,
			storage: await openRuntimeStorage(await openDatabase(join(home, "state.db"))),
			config: { schema: 1 },
			resolveSession: async () => ({
				agent: "agent",
				profile: "default",
				cwd: home,
				resolved: resolveProfile({ level: "bypass" }),
				bindings,
			}),
		});
		const session = await runtime.create({ agent: "agent", profile: "default", cwd: home });
		await runtime.configure(session);
		const config = await runtime.sessionConfig(session);
		const internal = runtime as unknown as {
			invocationConfigs: WeakMap<
				object,
				{ config: RuntimeSessionConfig; events: YEvent[]; operationSequence: number; runId?: string }
			>;
			context(id: string, context: typeof C): Promise<{ autoReplySource?: string; runId?: string }>;
		};
		const route = (binding: string, waiting = false) => ({ agent: "agent", session, binding, waiting });
		const inbound = (conv: string, binding: string, waiting = false): YEvent => ({
			...newEvent({ type: "message.in", conv, data: { kind: "dm" } }),
			routes: [route(binding, waiting)],
		});
		const derive = (events: YEvent[], currentConfig: RuntimeSessionConfig = config, currentRunId?: string) =>
			autoReplySource(currentConfig, session, events, "41", currentRunId ?? "41");

		const first = inbound("conv:web:room", "web-auto");
		const last = inbound("conv:web:room", "web-auto");
		expect(derive([first, last])).toBe(last.id);
		expect(derive([first, inbound("conv:web:room", "unknown-binding")])).toBeUndefined();
		expect(derive([inbound("conv:web:room", "web-none")])).toBeUndefined();
		expect(derive([inbound("conv:web:room", "unknown-binding")])).toBeUndefined();
		expect(derive([inbound("conv:web:room", "web-auto", true)])).toBeUndefined();

		const ordinary = inbound("conv:web:room", "web-auto");
		const consoleInput = inbound("conv:console:main", "console-auto");
		expect(derive([ordinary, consoleInput])).toBeUndefined();
		expect(derive([consoleInput])).toBe(consoleInput.id);
		expect(derive([inbound("conv:console:main", "console-auto", true)])).toBeUndefined();
		expect(derive([last], config, "99")).toBeUndefined();
		expect(autoReplySource(config, session, [last], "41")).toBeUndefined();

		internal.invocationConfigs.set(C, { config, events: [first, last], operationSequence: 0, runId: "41" });
		const actualContext = await internal.context(session, C);
		expect(actualContext.runId).toBe("41");
		expect(actualContext).not.toHaveProperty("autoReplySource");
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
