import { readFileSync } from "node:fs";
import { registry } from "@yonder/core";
import { Check } from "typebox/value";
import { describe, expect, it } from "vitest";
import { eventValidation, mapEvent } from "../src/events.js";
import {
	EVENT_SCHEMAS,
	EVENT_TYPES,
	ModelRefSchema,
	NodeFactsSchema,
	SessionsOpenParamsSchema,
	SessionsRenameParamsSchema,
	ViewContentSchema,
	validate,
} from "../src/protocol/index.js";
import { Feed } from "../src/stream.js";

const contracts = readFileSync(new URL("../../../proposals/unified-client/contracts.md", import.meta.url), "utf8");
// No temporary undocumented methods. Future entries must name the card that removes them.
const allowlist: { name: string; removeBy: string }[] = [];
// §1 lists legacy groups as terminal.sessions/presets/... and identity.lookup/link/....
const documented = new Set(
	[...contracts.matchAll(/`([a-z]+\.[a-z]+(?:\/[a-z]+)+)`/g)].flatMap((match) => {
		const [first = "", ...rest] = (match[1] ?? "").split("/");
		const domain = first.slice(0, first.indexOf("."));
		return [first, ...rest.map((action) => `${domain}.${action}`)];
	}),
);

describe("frozen protocol contract", () => {
	it("registers each method once and documents every registered method", () => {
		const methods = registry.list();
		expect(new Set(methods.map(({ name }) => name)).size).toBe(methods.length);
		for (const { name } of methods) {
			expect(
				contracts.includes(`\`${name}\``) || documented.has(name) || allowlist.some((entry) => entry.name === name),
				name,
			).toBe(true);
		}
	});

	it("freezes named payload validators while allowing unknown event names", () => {
		expect(EVENT_TYPES).toEqual(Object.keys(EVENT_SCHEMAS));
		for (const type of EVENT_TYPES) {
			expect(contracts.includes(type), type).toBe(true);
			expect(validate(type, null), type).toBe(false);
		}
		expect(validate("future.event", { future: true })).toBe(true);
	});

	it("keeps the existing session.update projection and maps extended carriers, including replay", () => {
		const update = { type: "state", session: "s", running: false };
		expect(mapEvent("session.update", update)).toEqual({ type: "session.update", data: update });
		const payload = { session: "s", tokens: 12, window: 100, percent: 12, auto: true };
		const carrier = { type: "event", name: "context.updated", data: payload };
		const feed = new Feed("contract", "sessions.watch", true, () => {});
		feed.publish(carrier);
		const replay = feed.replay(`${feed.epoch}:0`) ?? [];
		expect(replay[0]?.seq).toBe(1);
		expect(mapEvent("session.update", replay[0]?.data)).toEqual({ type: "context.updated", data: payload });
		expect(mapEvent("session.update", { type: "event", name: "future.event", data: null })).toEqual({
			type: "future.event",
			data: null,
		});
		feed.close();
	});

	it("rejects malformed known events and retains only a body-free counter", () => {
		const before = eventValidation.rejected;
		expect(
			mapEvent("session.update", { type: "event", name: "context.updated", data: { text: "private" } }),
		).toBeUndefined();
		expect(
			mapEvent("activity.summary", { type: "event", name: "session.settled", data: { session: "s", status: "done" } }),
		).toEqual({
			type: "session.settled",
			data: { session: "s", status: "done" },
		});
		expect(mapEvent("session.update", { type: "event", data: null })).toBeUndefined();
		expect(eventValidation).toEqual({ rejected: before + 2 });
		const totals = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0 };
		expect(validate("usage.updated", { session: "s", scope: "self", totals })).toBe(true);
		expect(validate("usage.updated", { session: "s", scope: "self", totals: { ...totals, text: "private" } })).toBe(
			false,
		);
		expect(validate("approval.requested", { card: { value: "private" } })).toBe(false);
		expect(validate("reply.failed", { session: "s", notice: "回复失败", willRetry: false })).toBe(true);
		expect(validate("reply.failed", { session: "s", notice: "", willRetry: false })).toBe(false);
	});

	it("preserves the existing activity.summary payload", () => {
		const data = { running: 1, waiting: 0, sessions: [{ id: "s", agent: "a", state: "running" }] };
		expect(mapEvent("activity.summary", data)).toEqual({ type: "activity.summary", data });
	});

	it("validates frozen request boundaries without adding method implementations", () => {
		expect(Check(SessionsOpenParamsSchema, {})).toBe(false);
		expect(Check(SessionsOpenParamsSchema, { preset: "coding" })).toBe(true);
		expect(Check(SessionsOpenParamsSchema, { agent: "a", model: { provider: "openai", model: "gpt-6-luna" } })).toBe(
			true,
		);
		expect(Check(ModelRefSchema, { provider: "openai", id: "gpt-6-luna" })).toBe(false);
		expect(Check(SessionsRenameParamsSchema, { id: "s", title: "" })).toBe(false);
		expect(Check(SessionsRenameParamsSchema, { id: "s", title: "x".repeat(81) })).toBe(false);
		expect(Check(ViewContentSchema, { type: "input", prompt: "Name", secret: true })).toBe(false);
		expect(Check(ViewContentSchema, { type: "builtin", id: "core.todos", payload: null })).toBe(false);
		expect(NodeFactsSchema.properties).toHaveProperty("auth");
		expect(NodeFactsSchema.properties.features.properties).toHaveProperty("attachments");
	});
});
