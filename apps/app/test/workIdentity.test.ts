import { describe, expect, it } from "vitest";
import { branchLabel } from "../src/work/lib/branch";
import { deviceAgentMap } from "../src/work/lib/queries";
import { cloudBotEntries } from "../src/work/lib/work";

describe("工作台 Bot 身份", () => {
	it("只按选中设备和 agent key 匹配聊天账号", () => {
		const actor = {
			id: "actor",
			kind: "agent" as const,
			name: "名称",
			deviceId: "device",
			avatarUrl: "https://example.com/a.png",
		};
		const other = { ...actor, id: "other", deviceId: "other-device" };
		const map = deviceAgentMap("device", [
			{ key: "local-key", actor },
			{ key: "other-key", actor: other },
		]);
		expect(map.get("local-key")).toEqual(actor);
		expect(map.has("other-key")).toBe(false);
		const old = {
			id: "old",
			agent: "retired",
			profile: "default",
			mode: "main" as const,
			key: "main",
			version: "1",
			opened: "",
		};
		expect(cloudBotEntries([old], new Map())).toEqual([]);
		expect(cloudBotEntries([old], map)).toEqual([{ key: "local-key", actor, session: undefined }]);
	});

	it("分支优先展示真实名称，缺失时用可区分的会话标识", () => {
		const session = {
			id: "42",
			agent: "agent",
			profile: "default",
			mode: "persistent" as const,
			key: "conv:conv:card:agent:uuid",
			version: "1",
			opened: "",
		};
		const events = [{ data: { kind: "group", name: "发送者" }, routes: [{ session: "42" }] }];
		expect(branchLabel(session, events, [])).toContain("群聊 · 会话 agent:uuid");
		expect(branchLabel(session, [], [])).toContain("会话类型未知 · 会话 agent:uuid");
		expect(
			branchLabel(
				{ ...session, key: "conv:conv:feishu:oc_123" },
				[{ data: { kind: "dm" }, routes: [{ session: "42" }] }],
				[],
			),
		).toContain("私聊 · 会话 oc_123");
		expect(
			branchLabel(session, events, [{ id: "uuid", kind: "group", title: "真实群", memberIds: [], unread: 0 }]),
		).toContain("群聊 · 真实群");
	});
});
