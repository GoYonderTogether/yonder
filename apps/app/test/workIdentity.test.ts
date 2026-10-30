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

	it("分支展示真实渠道和会话信息；缺失名称不暴露内部 key", () => {
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
		expect(branchLabel(session, events, [])).toContain("群聊 · 名称未知");
		expect(branchLabel(session, events, [])).not.toContain("agent:uuid");
		expect(
			branchLabel(session, events, [{ id: "uuid", kind: "group", title: "真实群", memberIds: [], unread: 0 }]),
		).toContain("群聊 · 真实群");
	});
});
