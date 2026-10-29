import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { type AgentConfig, parseAgentConfig } from "../config/index.js";
import { testModel } from "../config/test-support.js";
import { initHome, inspectHome } from "./home.js";
import { canReceivePeerAsk, peerFix, withDefaultPeer } from "./peer.js";

const legacy = {
	id: "hermes",
	owner: "person:owner",
	defaultProfile: "owner",
	defaults: {},
	profiles: { owner: { level: "bypass" } },
	bindings: [{ id: "feishu", match: { channel: "feishu" }, session: "main", profile: "owner" }],
} as unknown as AgentConfig;

test("an older agent without a peer binding is reported and the fix matches what a new agent gets", () => {
	expect(canReceivePeerAsk(legacy)).toBe(false);
	const fix = peerFix(legacy, "local", testModel)!;
	expect(fix).toContain("peer:");
	expect(fix).toContain("channel: agent");
	expect(canReceivePeerAsk(withDefaultPeer(legacy, false, "local", testModel))).toBe(true);
});

test("init 建出来的 agent 自带 peer 绑定，老 agent 缺少时 doctor 说清影响与修法", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-doctor-peer-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const agent = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		// 脚手架：新建的 agent 必须已经被别的 agent 找得到。
		expect(canReceivePeerAsk(agent)).toBe(true);

		// 老 agent：去掉 peer profile 与绑定后，doctor 要给出影响、文件与复查命令。
		const legacy = {
			...agent,
			profiles: Object.fromEntries(Object.entries(agent.profiles).filter(([name]) => name !== "peer")),
			// 只留明确渠道的绑定：没有 channel/kind 的绑定按「不限渠道」算，仍能收到 peer 提问。
			bindings: agent.bindings.filter((binding) => binding.match.channel === "cli"),
		} as AgentConfig;
		await writeFile(file, stringify(legacy));
		const warning = (await inspectHome(home)).warnings.find((item) => item.startsWith("main: "))!;
		expect(warning).toContain("agent_ask");
		expect(warning).toContain("agents/main/agent.yaml");
		expect(warning).toContain("yonder doctor");
		expect(warning).toContain("channel: agent");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);
