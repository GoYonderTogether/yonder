import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAgentConfig } from "@yonder/local-host/config/index";
import { testModel } from "@yonder/local-host/config/test-support";
import { registry, socketPrincipal } from "@yonder/local-host/control/methods";
import { initHome, openKernel } from "@yonder/local-host/kernel/index";
import { releaseInfo } from "@yonder/local-host/release/index";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";

test("capabilities read the accepted plugin snapshot while an invalid Agent candidate is on disk", async () => {
	const home = await tempHome("ya-capabilities-snapshot-");
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "owner", { model: testModel });
		kernel = await openKernel(home);
		const file = join(home, "agents/main/agent.yaml");
		const candidate = parse(await readFile(file, "utf8"));
		candidate.bindings[0].profile = "missing-profile";
		const text = stringify(candidate);
		expect(() => parseAgentConfig(text, "agent.yaml", "main")).toThrow();
		await writeFile(file, text, { mode: 0o600 });
		const pluginList = (await kernel.management({ action: "plugins.list" })) as Array<{
			id: string;
			version: string;
			contributes: { views?: string[] };
		}>;

		const facts = (await registry.call(
			"capabilities.get",
			{},
			{
				kernel,
				home,
				principal: socketPrincipal,
				releaseInfo: () => releaseInfo(home),
				awakeStatus: () => ({}),
				stop: () => {},
			},
			new AbortController().signal,
		)) as { plugins: Array<{ id: string; version: string; views: string[] }> };
		expect(facts.plugins).toEqual(
			pluginList.map((plugin) => ({
				id: plugin.id,
				version: plugin.version,
				views: (plugin.contributes as { views?: string[] }).views ?? [],
			})),
		);
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
});
