import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("PluginAPI.agents.list is live, enabled-only and returns detached id/name values", async () => {
	const home = await mkdtemp("/tmp/yonder-agent-list-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "owner", { model: testModel });
		const directory = join(home, "probe");
		await mkdir(directory);
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({
				type: "module",
				version: "1.0.0",
				yonder: { apiVersion: 1, id: "agent-probe", entry: "./index.mjs", contributes: { channels: ["probe"] } },
			}),
		);
		await writeFile(
			join(directory, "index.mjs"),
			`export default {
  setup(api) {
    api.channels.register({
      type: 'probe', multiAgent: true,
      create(id) {
        return {
          id, kinds: ['dm'], output: {stream:false, attachments:false},
          async start(io) { await io.emit({type:'message.in',from:'acct:probe:human',conv:'conv:probe:room',data:{target:'main',kind:'dm',text:'binding check'}}); },
          async stop() {}, async send() { return {ok:false}; },
          async login() {
            const first = await api.agents.list(); first[0].name = 'mutated';
            return {instance:id, status:JSON.stringify(await api.agents.list())};
          }
        };
      }
    });
  }
};`,
		);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		config.plugins.push({ use: "./probe" });
		config.channels.probe = { type: "probe" };
		await writeFile(join(home, "yonder.yaml"), stringify(config));
		kernel = await openKernel(home);
		const list = async () =>
			JSON.parse(
				(await kernel!.channels.login({ instance: "probe", action: "poll" }, new AbortController().signal)).status,
			);
		expect(await list()).toEqual([{ id: "main", name: "Jarvis" }]);
		const incoming = (await kernel.events.query({ type: "message.in", conv: "conv:probe:room" })).events[0]!;
		expect(incoming.routes?.[0]).toMatchObject({ dropped: "no-binding", binding: null });
		await kernel.management({
			action: "presets.create",
			id: "probe",
			value: { description: "Agent API verification" },
		});
		await kernel.management({
			action: "agents.create",
			id: "extra",
			preset: "probe",
			value: { name: "Extra", work: "Verification", owner: "person:owner", bindings: [] },
		});
		expect(await list()).toEqual([
			{ id: "main", name: "Jarvis" },
			{ id: "extra", name: "Extra" },
		]);
		await kernel.management({
			action: "agents.update",
			id: "extra",
			value: { name: "Renamed", avatarUrl: "https://cdn.yonder.cn/renamed.png" },
		});
		expect(await list()).toContainEqual({
			id: "extra",
			name: "Renamed",
			avatarUrl: "https://cdn.yonder.cn/renamed.png",
		});
		await kernel.management({ action: "agents.archive", id: "extra" });
		expect(await list()).toEqual([{ id: "main", name: "Jarvis" }]);
		await kernel.management({ action: "agents.restore", id: "extra" });
		expect(await list()).toContainEqual({
			id: "extra",
			name: "Renamed",
			avatarUrl: "https://cdn.yonder.cn/renamed.png",
		});
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
});
