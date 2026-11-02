import { expect, test } from "vitest";
import type { AgentOperabilityFact } from "./operability.js";
import { summarizeAgentOperability } from "./operability-summary.js";

test("summarizes exact current-Agent evidence without turning it into membership or permission claims", () => {
	const summary = summarizeAgentOperability("helper", {
		status: "observed",
		limit: 20,
		truncated: false,
		conversations: [
			{
				status: "observed",
				selector: { conv: "conv:qq:group:sample", eventId: "sample-event" },
				sample: {
					eventId: "sample-event",
					conv: "conv:qq:group:sample",
					from: "acct:qq:owner",
					relation: "owner",
					senderIsBot: false,
				},
				history: {
					route: { binding: "group", session: "session-1", profile: "default", wake: "write" },
					execution: { state: "not-observed", runs: [{ runId: "run-1", path: "batch" }] },
					delivery: { state: "delivered", receipts: [{ eventId: "delivery-1", session: "session-1" }] },
				},
				prediction: {
					state: "matched",
					binding: "group",
					profile: "default",
					wake: "write",
					reply: "none",
					participation: { reason: "record", run: false },
					participationScope: { enabled: true, scope: ["secret-conv"], includesConversation: false },
					consumer: { state: "not-applicable", reason: "outside-social-scope" },
					capabilities: {
						values: ["secret-tool"],
						plugins: ["secret-plugin"],
						tools: { offer: ["secret"], search: [] },
						messageSend: false,
					},
				},
				configuration: { basis: "accepted", revision: "rev-1", acceptedRevision: "rev-1" },
				management: {
					paths: ["agents.validate", "agents.update", "inspect", "agents.show"],
					authority: "existing local agent management authorization required",
				},
			},
		],
	} satisfies AgentOperabilityFact);
	const json = JSON.stringify(summary);
	expect(json.length).toBeLessThanOrEqual(8000);
	expect(summary).toMatchObject({
		agent: "helper",
		scope: { basis: "current-agent-exact-binding-conversations", globalMembershipDirectory: false },
		conversations: [
			{
				conv: "conv:qq:group:sample",
				eventId: "sample-event",
				sample: { from: "acct:qq:owner", relation: "owner", senderIsBot: false },
				history: { route: { profile: "default", wake: "write" }, execution: { state: "not-observed" } },
				prediction: {
					wake: "write",
					reply: "none",
					participationScope: { includesConversation: false },
					capabilities: { messageSend: false },
				},
			},
		],
	});
	expect(json).not.toContain("secret-tool");
	expect(json).not.toContain("secret-plugin");
	expect(json).not.toContain("secret-conv");
	expect(summary.conversations[0]).not.toHaveProperty("selector");
});

test("omits whole facts when the summary budget is exceeded and reports omissions", () => {
	const conversations: AgentOperabilityFact["conversations"] = Array.from({ length: 8 }, (_, index) => ({
		status: "observed",
		selector: { conv: `conv:${index}` },
		sample: { eventId: `event-${index}`, conv: `conv:${index}`, from: "acct:owner", relation: "owner" },
		prediction: { state: "matched", binding: "b".repeat(1800), profile: "p".repeat(1800), wake: "run", reply: "auto" },
	}));
	const summary = summarizeAgentOperability("agent", {
		status: "observed",
		limit: 8,
		truncated: false,
		conversations,
	});
	expect(JSON.stringify(summary).length).toBeLessThanOrEqual(8000);
	expect(summary.truncated).toBe(true);
	expect(summary.omitted).toBeGreaterThan(0);
	for (const item of JSON.parse(JSON.stringify(summary)).conversations) {
		expect(item.sample?.eventId).toMatch(/^event-/);
		expect(item.prediction?.binding).toBe("b".repeat(1800));
	}
});
