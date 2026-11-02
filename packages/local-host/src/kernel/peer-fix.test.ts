import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canReceivePeerAsk, peerFix, withDefaultPeer } from "@yonder/bot-core/kernel/peer";
import { type AgentConfig, parseAgentConfig } from "@yonder/local-host/config/index";
import { testModel } from "@yonder/local-host/config/test-support";
import { initHome, inspectHome } from "@yonder/local-host/kernel/home";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { stringify } from "yaml";

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
	const home = await tempHome("yonder-doctor-peer-");
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
		const warning = (await inspectHome(home)).warnings.find(
			(item) => item.startsWith("main: ") && item.includes("agent_ask"),
		)!;
		expect(warning).toContain("agent_ask");
		expect(warning).toContain("agents/main/agent.yaml");
		expect(warning).toContain("yonder doctor");
		expect(warning).toContain("channel: agent");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);

test("doctor explains custom parent-request mismatch without replacing the user's route", async () => {
	const home = await tempHome("yonder-doctor-parent-request-");
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const agent = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		const binding = agent.bindings.find((item) => item.id === "parent-request");
		if (!binding) throw new Error("Default parent-request binding missing");
		binding.match.from = "acct:agent:someone-else";
		binding.session = "ephemeral";
		await writeFile(file, stringify(agent));

		const warning = (await inspectHome(home)).warnings.find((item) => item.includes("自定义 parent-request 路由"));
		expect(warning).toContain("from=acct:agent:main");
		expect(warning).toContain("session=main");
		expect(warning).toContain("agents validate");
		const after = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		expect(after.bindings.find((item) => item.id === "parent-request")).toMatchObject({
			match: { from: "acct:agent:someone-else" },
			session: "ephemeral",
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);

test("doctor identifies when parent_ask has no main binding and gives a bounded repair path", async () => {
	const home = await tempHome("yonder-doctor-parent-request-missing-");
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const agent = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		await writeFile(
			file,
			stringify({ ...agent, bindings: agent.bindings.filter((item) => item.id !== "parent-request") }),
		);

		const report = await inspectHome(home);
		const warning = report.warnings.find((item) => item.includes("parent_ask 没有通往所属主会话"));
		expect(warning, JSON.stringify(report)).toBeDefined();
		expect(warning).toContain("from=acct:agent:main");
		expect(warning).toContain("session=main");
		expect(warning).toContain("agents validate");
		expect(
			parseAgentConfig(await readFile(file, "utf8"), file, "main").bindings.some(
				(item) => item.id === "parent-request",
			),
		).toBe(false);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60000);
