import { describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/api/types";
import { contactRowMenu } from "../src/lib/contactMenu";

const actor: Actor = { id: "a1", kind: "human", name: "Alice" };
const noop = () => {};

describe("contactRowMenu", () => {
	it("联系人行有发消息与打开资料", () => {
		const message = vi.fn();
		const profile = vi.fn();
		const items = contactRowMenu({ actor, meId: "me", message, profile });
		expect(items.map((i) => i.key)).toEqual(["message", "profile"]);
		items[0]?.onSelect();
		items[1]?.onSelect();
		expect(message).toHaveBeenCalledOnce();
		expect(profile).toHaveBeenCalledOnce();
	});

	it("自己不显示发消息", () => {
		const items = contactRowMenu({ actor, meId: "a1", message: noop, profile: noop });
		expect(items.map((i) => i.key)).toEqual(["profile"]);
	});

	it("不知道当前身份时保留发消息（与资料页一致）", () => {
		const items = contactRowMenu({ actor, message: noop, profile: noop });
		expect(items.map((i) => i.key)).toEqual(["message", "profile"]);
	});
});
