import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialSlotStore } from "./credential-slots.js";

const roots: string[] = [];
function setup() {
	const root = mkdtempSync(join(realpathSync(tmpdir()), "yonder-slots-"));
	roots.push(root);
	const path = join(root, "auth.json");
	writeFileSync(
		path,
		JSON.stringify({
			openai: { type: "api_key", key: "default-test" },
			service: { type: "api_key", key: "named-test" },
		}),
		{ mode: 0o600 },
	);
	return { root, path, slots: new CredentialSlotStore(path) };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("credential slots", () => {
	it("isolates simultaneous slots while retaining exact default/named bytes and private file modes", async () => {
		const { path, slots } = setup();
		const before = readFileSync(path, "utf8");
		await Promise.all(
			["a", "b"].map(async (slot) => {
				const ticket = await slots.beginLogin("openai", slot);
				await slots.commitLogin(ticket, { type: "api_key", key: slot });
			}),
		);
		const [a, b] = await Promise.all([
			slots.bind({ openai: "a" }).read("openai"),
			slots.bind({ openai: "b" }).read("openai"),
		]);
		expect(a).toEqual({ type: "api_key", key: "a" });
		expect(b).toEqual({ type: "api_key", key: "b" });
		expect(readFileSync(path, "utf8")).toBe(before);
		expect(statSync(`${path}.slots/openai/a.auth.json`).mode & 0o777).toBe(0o600);
		expect(statSync(`${path}.slots/openai`).mode & 0o777).toBe(0o700);
		expect(JSON.stringify(await slots.list())).not.toContain('"key"');
	});
	it("rejects unknown, unconfigured, traversal and reserved names rather than falling back", async () => {
		const { slots } = setup();
		await expect(slots.bind({ openai: "missing" }).read("openai")).rejects.toThrow("Unknown credential slot");
		await slots.create("openai", "empty");
		await expect(slots.bind({ openai: "empty" }).read("openai")).rejects.toThrow("not configured");
		for (const name of ["../a", "A", "constructor", "a.b", ""]) expect(() => slots.bind({ openai: name })).toThrow();
	});
	it("create-only CAS admits one writer; replace and remove invalidate late login but refresh does not", async () => {
		const { slots } = setup();
		const first = await slots.beginLogin("openai", "a");
		const racing = await slots.beginLogin("openai", "a");
		await slots.commitLogin(first, { type: "api_key", key: "one" });
		await expect(slots.commitLogin(racing, { type: "api_key", key: "two" })).rejects.toThrow("changed");
		await expect(slots.beginLogin("openai", "a")).rejects.toThrow("explicit");
		const replacement = await slots.beginLogin("openai", "a", true);
		await slots.bind({ openai: "a" }).modify("openai", async () => ({ type: "api_key", key: "refresh" }));
		await slots.commitLogin(replacement, { type: "api_key", key: "replaced" });
		const stale = await slots.beginLogin("openai", "a", true);
		await slots.remove("openai", "a");
		await expect(slots.commitLogin(stale, { type: "api_key", key: "late" })).rejects.toThrow("changed");
		await expect(slots.bind({ openai: "a" }).read("openai")).rejects.toThrow("Unknown");
	});
	it("same slot modifications serialize and different slot locks progress independently", async () => {
		const { slots } = setup();
		for (const slot of ["a", "b"])
			await slots.commitLogin(await slots.beginLogin("openai", slot), { type: "api_key", key: "0" });
		let release!: () => void;
		let entered!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const pending = slots.bind({ openai: "a" }).modify("openai", async () => {
			entered();
			await held;
			return { type: "api_key", key: "1" };
		});
		await started;
		await slots.bind({ openai: "b" }).modify("openai", async () => ({ type: "api_key", key: "2" }));
		const controller = new AbortController();
		const cancelled = slots.bind({ openai: "a" }).read("openai", { signal: controller.signal });
		controller.abort();
		await expect(cancelled).rejects.toThrow();
		release();
		await pending;
		expect(await slots.bind({ openai: "a" }).read("openai")).toEqual({ type: "api_key", key: "1" });
	});
	it("rejects symlink slot paths and missing env refs", async () => {
		const { path, root, slots } = setup();
		symlinkSync(root, `${path}.slots`);
		await expect(slots.create("openai", "a")).rejects.toThrow("Unsafe");
	});
	it("env references resolve only the explicit variable and fail when absent", async () => {
		const { slots } = setup();
		await slots.create("openai", "env", { kind: "env-ref", variable: "YONDER_T63_MISSING_TEST_ENV" });
		await expect(slots.bind({ openai: "env" }).read("openai")).rejects.toThrow("reference is not configured");
	});
});
