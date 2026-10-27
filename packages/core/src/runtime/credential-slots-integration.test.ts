import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { CredentialSlotStore } from "./credential-slots.js";

const exec = promisify(execFile);
const roots: string[] = [];
function setup() {
	const root = mkdtempSync(join(realpathSync(tmpdir()), "yonder-slot-integration-"));
	roots.push(root);
	const path = join(root, "auth.json");
	return { root, path, slots: new CredentialSlotStore(path) };
}
async function until(check: () => boolean) {
	const deadline = Date.now() + 10000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Credential probe barrier timed out");
		await new Promise((done) => setTimeout(done, 5));
	}
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function seed(slots: CredentialSlotStore, slot: string) {
	await slots.commitLogin(await slots.beginLogin("openai", slot), {
		type: "oauth",
		access: "fixture-old",
		refresh: "fixture-refresh",
		expires: 0,
	});
}
it.each(["same", "different", "cancel"])("persists cross-process refresh with %s slot timing", async (mode) => {
	const { root, path, slots } = setup();
	await seed(slots, "a");
	if (mode === "different") await seed(slots, "b");
	const gate = join(root, "release");
	const marker = join(root, "refresh-count");
	const run = (slot: string, cancel = "") =>
		exec(process.execPath, [resolve("scripts/fixtures/credential-refresh.mjs"), path, slot, gate, marker, cancel]);
	const first = run("a", mode === "cancel" ? "cancel" : "");
	await until(() => existsSync(`${marker}.a.entered`));
	const second = mode === "cancel" ? undefined : run(mode === "different" ? "b" : "a");
	if (mode === "different") await until(() => existsSync(`${marker}.b.entered`));
	writeFileSync(gate, "release");
	expect((await first).stdout.trim()).toBe("persisted");
	if (second) expect((await second).stdout.trim()).toBe("persisted");
	expect(readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(mode === "different" ? 2 : 1);
});
it("freezes account generations across refresh, replacement, same-name recreation, and restored bindings", async () => {
	const { slots } = setup();
	await seed(slots, "a");
	const selection = { openai: "a" };
	const generations = await slots.capture(selection);
	const pinned = slots.bind(selection, generations);
	await pinned.modify("openai", async (value) => ({
		...value,
		type: "oauth",
		access: "refreshed",
		refresh: "rotated",
		expires: 1000,
	}));
	expect((await slots.bind(selection, JSON.parse(JSON.stringify(generations))).read("openai"))?.type).toBe("oauth");
	await slots.commitLogin(await slots.beginLogin("openai", "a", true), { type: "api_key", key: "replacement" });
	await expect(pinned.read("openai")).rejects.toThrow("account changed");
	await expect(slots.bind(selection, generations).read("openai")).rejects.toThrow("account changed");
	await slots.remove("openai", "a");
	await seed(slots, "a");
	await expect(slots.bind(selection, generations).read("openai")).rejects.toThrow("account changed");
});
it("rejects default env-ref instead of silently using ambient/default identity", async () => {
	const { slots } = setup();
	await expect(slots.create("openai", "default", { kind: "env-ref", variable: "TEST_KEY" })).rejects.toThrow(
		"Default slot",
	);
});
it("cancelled secret-lock wait leaves metadata unchanged and another login ticket valid", async () => {
	const { slots, path } = setup();
	const a = await slots.beginLogin("openai", "default");
	const b = await slots.beginLogin("openai", "default");
	const metadata = `${path}.slots/openai/default.meta.json`;
	const before = readFileSync(metadata, "utf8");
	let release!: () => void;
	let entered!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	const started = new Promise<void>((done) => {
		entered = done;
	});
	const lock = slots.defaults.modify("anthropic", async () => {
		entered();
		await held;
		return { type: "api_key", key: "fixture" };
	});
	await started;
	const controller = new AbortController();
	const commit = slots.commitLogin(a, { type: "api_key", key: "cancelled" }, { signal: controller.signal });
	await new Promise((done) => setTimeout(done, 40));
	controller.abort();
	await expect(commit).rejects.toThrow();
	expect(readFileSync(metadata, "utf8")).toBe(before);
	release();
	await lock;
	await slots.commitLogin(b, { type: "api_key", key: "winner" });
	expect(await slots.defaults.read("openai")).toEqual({ type: "api_key", key: "winner" });
});
