import {
	chmodSync,
	existsSync,
	linkSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FileCredentials, storeNamedCredential } from "./credentials.js";

const dirs: string[] = [];
function location() {
	const dir = mkdtempSync(join(realpathSync(tmpdir()), "yonder-named-"));
	dirs.push(dir);
	return join(dir, "auth.json");
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
it("creates 0600 and preserves concurrent OAuth modify under the same lock", async () => {
	const path = location();
	const credentials = new FileCredentials(path);
	await credentials.modify("openai", async () => ({
		type: "oauth",
		access: "test-access",
		refresh: "test-refresh",
		expires: 1,
	}));
	let entered!: () => void;
	const ready = new Promise<void>((r) => {
		entered = r;
	});
	let release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const refreshing = credentials.modify("openai", async () => {
		entered();
		await gate;
		return { type: "oauth", access: "test-new", refresh: "test-new-refresh", expires: 2 };
	});
	await ready;
	const saving = storeNamedCredential(path, "feishu-hermes-app-secret", "test-only-key");
	release();
	await Promise.all([refreshing, saving]);
	expect((await credentials.read("openai"))?.type).toBe("oauth");
	expect(JSON.parse(readFileSync(path, "utf8")).openai.refresh).toBe("test-new-refresh");
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(await credentials.read("feishu-hermes-app-secret")).toEqual({ type: "api_key", key: "test-only-key" });
});
it("refuses replacement including OAuth; cancelled write changes nothing", async () => {
	const path = location();
	await storeNamedCredential(path, "existing", "test-only-key");
	const before = readFileSync(path, "utf8");
	await expect(storeNamedCredential(path, "existing", "new-test-key")).rejects.toThrow("already exists");
	await expect(storeNamedCredential(path, "new", "new-test-key", AbortSignal.abort())).rejects.toThrow();
	expect(readFileSync(path, "utf8")).toBe(before);
});
it("cancellation before creation leaves no store", async () => {
	const path = location();
	await expect(storeNamedCredential(path, "new", "test-only-key", AbortSignal.abort())).rejects.toThrow();
	expect(existsSync(path)).toBe(false);
});
it("refuses symlink, hardlink, permissive file and writable parent without modifying targets", async () => {
	for (const kind of ["symlink", "hardlink", "mode", "parent"]) {
		const path = location();
		const target = `${path}.target`;
		writeFileSync(target, "{}", { mode: 0o600 });
		if (kind === "symlink") symlinkSync(target, path);
		if (kind === "hardlink") linkSync(target, path);
		if (kind === "mode") writeFileSync(path, "{}", { mode: 0o644 });
		if (kind === "parent") chmodSync(join(path, ".."), 0o777);
		await expect(storeNamedCredential(path, "new", "test-only-key")).rejects.toThrow("Unsafe");
		expect(readFileSync(target, "utf8")).toBe("{}");
	}
});
it("rejects malformed stores and unsafe names without leaking parse content", async () => {
	const path = location();
	writeFileSync(path, "not-json-test", { mode: 0o600 });
	await expect(storeNamedCredential(path, "new", "test-only-key")).rejects.toThrow("cannot parse JSON");
	await expect(storeNamedCredential(path, "__proto__", "test-only-key")).rejects.toThrow("Invalid credential name");
});
it("aborts while waiting for OAuth lock without appending a credential", async () => {
	const path = location();
	const credentials = new FileCredentials(path);
	let entered!: () => void;
	const ready = new Promise<void>((r) => {
		entered = r;
	});
	let release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const held = credentials.modify("openai", async () => {
		entered();
		await gate;
		return { type: "oauth", access: "test-access", refresh: "test-refresh", expires: 1 };
	});
	await ready;
	const controller = new AbortController();
	const saving = storeNamedCredential(path, "cancelled", "test-only-key", controller.signal);
	controller.abort();
	await expect(saving).rejects.toThrow();
	release();
	await held;
	expect(await credentials.read("cancelled")).toBeUndefined();
});
it("refuses a symlink ancestor before creating any credential file", async () => {
	const path = location();
	const alias = `${path}.alias`;
	symlinkSync(join(path, ".."), alias);
	await expect(storeNamedCredential(join(alias, "nested-auth.json"), "new", "test-only-key")).rejects.toThrow("Unsafe");
	expect(existsSync(join(path, "..", "nested-auth.json"))).toBe(false);
});
