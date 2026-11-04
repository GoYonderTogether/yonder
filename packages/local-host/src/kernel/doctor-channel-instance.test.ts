import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testModel } from "@yonder/local-host/config/test-support";
import { initHome, inspectHome } from "@yonder/local-host/kernel/home";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";

test("doctor reports a channel instance with invalid config instead of failing startup (JV2-J09-03)", async () => {
	const home = await tempHome("yonder-doctor-channel-");
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.plugins = [...config.plugins, { use: "@yonder/plugin-channel-qq" }];
		config.channels = { ...config.channels, qq: { type: "qq" } };
		await writeFile(file, stringify(config));
		const report = await inspectHome(home);
		expect(report.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^channels\.qq: 实例已跳过.*appId/)]));
		expect(report.errors.filter((error) => error.includes("unknown channel"))).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 120000);
