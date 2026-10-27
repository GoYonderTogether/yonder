import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelHealth } from "./model-health.js";

const roots: string[] = [];
function setup(now = { value: 1_000_000 }) {
	const root = mkdtempSync(join(tmpdir(), "yonder-health-"));
	roots.push(root);
	const path = join(root, ".yonder", "model-health.json");
	return { path, now, health: new ModelHealth(path, () => now.value) };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("model health", () => {
	it("keeps healthy order and moves held entries to the back", async () => {
		const { health, now } = setup();
		await health.hold(["b"], "quota", 600, 60);
		expect(health.order(["a", "b", "c"], (key) => key)).toEqual(["a", "c", "b"]);
		now.value += 600_000;
		expect(health.order(["a", "b", "c"], (key) => key)).toEqual(["a", "b", "c"]);
	});
	it("reports only held entries whose probe is due", async () => {
		const { health, now } = setup();
		await health.hold(["a"], "quota", 600, 60);
		expect(health.due()).toEqual([]);
		now.value += 60_000;
		expect(health.due()).toEqual(["a"]);
		await health.probed(["a"], 60);
		expect(health.due()).toEqual([]);
	});
	it("clears a hold as soon as the model answers", async () => {
		const { health } = setup();
		await health.hold(["a"], "quota", 600, 60);
		expect(health.held("a")).toBe(true);
		await health.clear(["a"]);
		expect(health.held("a")).toBe(false);
		expect(health.snapshot()).toEqual({});
	});
	it("survives a restart and ignores a corrupt file", async () => {
		const { path, health } = setup();
		await health.hold(["openai/m@gpt2"], "model_error: quota", 600, 60, 2);
		const reopened = new ModelHealth(path, () => 1_000_000);
		await reopened.load();
		expect(reopened.held("openai/m@gpt2")).toBe(true);
		expect(reopened.snapshot()["openai/m@gpt2"]).toMatchObject({ reason: "model_error: quota", failures: 2 });
	});
	it("does nothing when the hold window is disabled", async () => {
		const { health } = setup();
		await health.hold(["a"], "quota", 0, 60);
		expect(health.snapshot()).toEqual({});
	});
});
