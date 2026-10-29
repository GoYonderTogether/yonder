import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { modelRecovery } from "../../../../node_modules/@earendil-works/pi-durable/dist/harness/model-recovery.js";
import { resolveProfile } from "../config/test-support.js";
import { credentialFailure, upstreamFailure, withCredentialMark } from "./credential-failure.js";
import { fallbackReason, modelChain } from "./model-chain.js";
import { ModelGate } from "./model-gate.js";
import { ModelHealth } from "./model-health.js";
import { ModelQuota } from "./model-quota.js";
import { ModelWatch, type ModelWatchOptions } from "./model-watch.js";
import type { RuntimeRun, RuntimeSessionConfig } from "./types.js";

const invalidGrant =
	'OAuth refresh failed for openai: OpenAI OAuth token request failed (400): {"error":"invalid_grant"}';
const policy = { enabled: true, maxRetries: 3, baseDelayMs: 1, maxAgentDelayMs: 1 };
const fallback = { models: [{ provider: "workbuddy", modelId: "flash" }], after: 3 };
const failed = (errorMessage: string) => ({ stopReason: "error", errorMessage }) as AssistantMessage;

async function marked(text: string): Promise<string | undefined> {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "error", reason: "error", error: failed(text) });
	stream.end();
	return (await withCredentialMark(stream, "openai").result()).errorMessage;
}

test("credential failures are told apart from network and content errors", () => {
	expect(credentialFailure(invalidGrant)).toBe(true);
	expect(credentialFailure("Provider is not configured: openai")).toBe(true);
	expect(credentialFailure("OAuth refresh failed for openai: fetch failed")).toBe(false);
	expect(credentialFailure("400 invalid_request: bad temperature")).toBe(false);
});

test("invalid_grant stopped the run before the mark and advances the chain after it", async () => {
	expect(modelRecovery(failed(invalidGrant), policy, 1, false, fallback).advance).toBe(false);
	const text = await marked(invalidGrant);
	expect(text).toContain("yonder login openai --replace");
	expect(modelRecovery(failed(text ?? ""), policy, 1, false, fallback).advance).toBe(true);
	// a content error still does not advance
	expect(modelRecovery(failed("400 invalid_request: bad temperature"), policy, 1, false, fallback).advance).toBe(false);
});

test("the credential-failed candidate is held, other candidates run, and a recovered credential restores it", async () => {
	const dir = await mkdtemp("/tmp/yonder-credfail-");
	try {
		const health = new ModelHealth(join(dir, "health.json"));
		const gate = new ModelGate(health, new ModelQuota(join(dir, "quota.json")));
		const watch = new ModelWatch({ health, gate } as ModelWatchOptions);
		const resolved = resolveProfile({ model: "openai/gpt-6.1-sol", fallback: { models: ["workbuddy/flash"] } });
		const config = { resolved } as RuntimeSessionConfig;
		const chain = modelChain(resolved.model, resolved.fallback, resolved.credentialSlots);
		const run = { status: "done", model: "workbuddy/flash" } as RuntimeRun;
		await watch.record(config, run, [
			{ model: { provider: "openai", modelId: "gpt-6.1-sol" }, action: "fallback", error: await marked(invalidGrant) },
		]);
		expect(health.held("openai/gpt-6.1-sol@default")).toBe(true);
		expect(watch.order(chain, undefined).map((entry) => entry.base)).toEqual(["workbuddy", "openai"]);
		// A successful probe after `yonder login --replace` clears the hold through the existing mechanism.
		await health.clear(["openai/gpt-6.1-sol@default"]);
		expect(watch.order(chain, undefined).map((entry) => entry.base)).toEqual(["openai", "workbuddy"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

const gateway503 =
	'503 {"message":"no usable account for realm \'intl\': all are disabled, cooling down, expired or parked by the daily token limit","type":"server_error","code":503}';
async function markedUpstream(text: string): Promise<string | undefined> {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "error", reason: "error", error: failed(text) });
	stream.end();
	return (await withCredentialMark(stream, "workbuddy").result()).errorMessage;
}

test("gateway 5xx / pool exhaustion advances the chain on the first failure", async () => {
	expect(modelRecovery(failed(gateway503), policy, 1, true, fallback).advance).toBe(false);
	for (const raw of [gateway503, "502 Bad Gateway", "Overloaded", "all accounts cooling down"]) {
		const text = (await markedUpstream(raw)) ?? "";
		expect(text).toContain(raw);
		expect(modelRecovery(failed(text), policy, 1, true, fallback).advance).toBe(true);
		expect(fallbackReason(text)).toBe("unavailable");
	}
	expect(upstreamFailure("429 too many requests")).toBe(false); // already immediate in pi-durable
});

test("parameter errors do not fall back", async () => {
	const raw = "400 invalid_request_error: bad temperature";
	expect(upstreamFailure(raw)).toBe(false);
	expect(modelRecovery(failed((await markedUpstream(raw)) ?? ""), policy, 1, false, fallback).advance).toBe(false);
});
