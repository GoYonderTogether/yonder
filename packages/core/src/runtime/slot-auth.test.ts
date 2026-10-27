import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { YonderConfig } from "../config/index.js";
import { loginProvider } from "./auth.js";
import { CredentialSlotStore } from "./credential-slots.js";
import { buildModels } from "./models.js";

const roots: string[] = [];
function setup() {
	const root = mkdtempSync(join(realpathSync(tmpdir()), "yonder-slot-auth-"));
	roots.push(root);
	const config = { credentials: "auth.json" } as YonderConfig;
	return { root, config, slots: new CredentialSlotStore(join(root, "auth.json")) };
}
afterEach(() => {
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("runs the actual provider key flow with explicit slot and refuses accidental replacement", async () => {
	const { root, config, slots } = setup();
	const interaction = { prompt: async () => "test-only-slot-key", notify: () => {} };
	await loginProvider(root, config, "openai", interaction, { method: "api_key", slot: "a" });
	expect(await slots.status("openai", "a")).toMatchObject({ configured: true, type: "api_key" });
	await expect(loginProvider(root, config, "openai", interaction, { method: "api_key", slot: "a" })).rejects.toThrow(
		"explicit",
	);
	await loginProvider(
		root,
		config,
		"openai",
		{ ...interaction, prompt: async () => "test-only-replacement" },
		{ method: "api_key", slot: "a", replace: true },
	);
	expect(await slots.bind({ openai: "a" }).read("openai")).toEqual({ type: "api_key", key: "test-only-replacement" });
});

it("keeps named slots independent and leaves unlisted providers on the old default auth behavior", async () => {
	const { slots } = setup();
	vi.stubEnv("OPENAI_API_KEY", "ambient-test-only");
	vi.stubEnv("ANTHROPIC_API_KEY", "unlisted-test-only");
	for (const slot of ["a", "b"])
		await slots.commitLogin(await slots.beginLogin("openai", slot), { type: "api_key", key: `slot-${slot}` });
	const a = buildModels(slots.bind({ openai: "a" }), {}, { openai: "a" });
	const b = buildModels(slots.bind({ openai: "b" }), {}, { openai: "b" });
	expect((await a.getAuth("openai"))?.auth.apiKey).toBe("slot-a");
	expect((await b.getAuth("openai"))?.auth.apiKey).toBe("slot-b");
	expect((await a.getAuth("anthropic"))?.auth.apiKey).toBe("unlisted-test-only");
	expect(
		(await buildModels(slots.bind({ openai: "default" }), {}, { openai: "default" }).getAuth("openai"))?.auth.apiKey,
	).toBe("ambient-test-only");
	expect(a.getProvider("radius")).not.toBe(b.getProvider("radius"));
	await slots.remove("openai", "a");
	await expect(a.getAuth("openai")).rejects.toThrow();
	expect((await b.getAuth("openai"))?.auth.apiKey).toBe("slot-b");
});

it("cancelled key flow preserves the exact default file and cannot revive a deleted slot", async () => {
	const { root, config, slots } = setup();
	await slots.defaults.modify("openai", async () => ({ type: "api_key", key: "default-test-only" }));
	const before = readFileSync(join(root, "auth.json"), "utf8");
	const controller = new AbortController();
	await expect(
		loginProvider(
			root,
			config,
			"openai",
			{
				signal: controller.signal,
				prompt: async () => {
					controller.abort();
					return "not-saved-test-only";
				},
				notify: () => {},
			},
			{ method: "api_key", slot: "a" },
		),
	).rejects.toThrow();
	expect(readFileSync(join(root, "auth.json"), "utf8")).toBe(before);
	expect((await slots.status("openai", "a")).configured).toBe(false);
});
