import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activitySummary, presentActivity } from "../web/activity.mjs";

const cases = JSON.parse(await readFile(new URL("../../../packages/macos/test/activity-cases.json", import.meta.url)));
for (const item of cases) {
	const actual = presentActivity(item.agent, item.known, item.summary);
	for (const key of ["state", "label", "emphasized"])
		assert.equal(actual[key], item.expected[key], `${item.name}: ${key}`);
}
const blocked = cases.find((item) => item.name === "可见事项阻塞");
assert.equal(presentActivity(blocked.agent, true, blocked.summary).items, "阻塞 2 · 待检查 1");
const cleared = { ...blocked.summary, summary: { schemaVersion: 1, observedAt: 2, agents: [] } };
assert.equal(presentActivity(blocked.agent, true, cleared).state, "idle");
for (const bad of [
	undefined,
	{},
	{ ...blocked.summary, summary: { schemaVersion: 1, observedAt: 1, agents: [null] } },
	{
		...blocked.summary,
		summary: { schemaVersion: 1, observedAt: 1, agents: [{ agentId: "test", blocked: -1, review: 1, waitingUser: 0 }] },
	},
	{ ...blocked.summary, sourceRevision: -1 },
]) {
	assert.equal(activitySummary(bad).availability, "unavailable");
	assert.equal(presentActivity(blocked.agent, true, bad).state, "idle");
	assert.equal(presentActivity(blocked.agent, true, bad).items, "事项状态暂不可用");
}
console.log(
	`Passed ${cases.length} shared Swift/JS activity cases, count clearing and malformed/unavailable summary checks.`,
);
