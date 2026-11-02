import { expect, test } from "vitest";
import { isUserVisibleBotSpeech } from "./messages.js";

test("only confirmed bot speech is visible; a delivered error is never speech", () => {
	expect(isUserVisibleBotSpeech({ type: "message.out", data: { text: "sent", delivery: { ok: true } } })).toBe(true);
	expect(
		isUserVisibleBotSpeech({
			type: "message.out",
			data: { content: { type: "error", text: "HTTP 503" }, delivery: { ok: true } },
		}),
	).toBe(false);
	expect(isUserVisibleBotSpeech({ type: "message.out", data: { delivery: { ok: false } } })).toBe(false);
	expect(isUserVisibleBotSpeech({ type: "channel-card.anchor-updated", data: { delivery: { ok: true } } })).toBe(true);
	expect(
		isUserVisibleBotSpeech({
			type: "channel-card.anchor-updated",
			data: { content: { type: "error" }, delivery: { ok: true } },
		}),
	).toBe(false);
	expect(isUserVisibleBotSpeech({ type: "message.in", data: { text: "received" } })).toBe(false);
});
