import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import type { KernelServices } from "./index.js";
import { loadPlugins } from "./index.js";

const unused = async (): Promise<never> => { throw new Error("unexpected plugin service call"); };

it("loads both first-party plugins through the manifest and registration checks", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-plugin-load-"));
	try {
		const services = {
			events: { emit: unused, ask: unused, query: unused },
			messages: { send: unused },
			credentials: { get: unused },
			sessions: {
				list: unused, get: unused, open: unused, submit: unused, abort: unused, close: unused, transcript: unused,
			},
			identity: {
				account: unused, person: unused, createPerson: unused, link: unused, unlink: unused,
				relation: unused, lookup: unused,
			},
			services: { resolve: unused },
			models: new Proxy({}, { get: () => { throw new Error("unexpected model access"); } }),
			log: console,
		} as unknown as KernelServices;
		const plugins = await loadPlugins(home, {
			schema: 1,
			plugins: [{ use: "@yonder/plugin-channel-cli" }, { use: "@yonder/plugin-context-files" }],
			channels: { cli: { type: "cli" } },
			envs: { local: { type: "local" } },
		}, services);
		expect([...plugins.channels.keys()]).toEqual(["cli"]);
		expect([...plugins.contexts.keys()]).toEqual(["agents-md", "user-md", "soul-md", "memory-md"]);
		expect(plugins.envs.size).toBe(0);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
