import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { capture } from "../src/capture.js";
import { Store } from "../src/store.js";

const run = promisify(execFile),
	enabled = process.platform === "darwin" && process.env.YONDER_TEST_KEYCHAIN === "1";
const scope = { agent: "main", profile: "owner", session: "1" };
const signal = () => AbortSignal.timeout(60000);
test.skipIf(!enabled)(
	"actual Keychain binary bytes, restart redaction and exact 0600 sealed file; no plaintext metadata",
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "yonder-keychain-"))),
			store = new Store(root, { maxBytes: 65536, ttlSeconds: 3600 });
		let clip: Awaited<ReturnType<Store["save"]>> | undefined;
		const value = Buffer.from(`generated-${randomBytes(40).toString("hex")}\n中文🦤\r\0`);
		try {
			await store.ensure();
			await store.kernel.prepare(signal());
			clip = await store.save(value, "sealed", scope, { type: "test", ref: "generated" }, signal());
			await store.consume(clip, signal(), async (data) => expect(data.equals(value)).toBe(true));
			expect((await readFile(store.path(clip.id), "utf8")).includes(value.toString())).toBe(false);
			const reopened = new Store(root, store.config),
				text = value.toString();
			expect((await reopened.redact(`before:${text}:after`, signal())).text).toBe("before:[sealed]:after");
			expect(
				(await reopened.redact(JSON.stringify({ value: text }), signal())).text.includes(
					JSON.stringify(text).slice(1, -1),
				),
			).toBe(false);
			await writeFile(store.path(clip.id), JSON.stringify({ ...clip, expiresAt: new Date(0).toISOString() }));
			expect((await reopened.redact(text, signal())).text).toBe("[sealed]");
			await reopened.drop(clip, signal());
			clip = undefined;
		} finally {
			if (clip) await store.drop(clip, signal());
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
test.skipIf(!enabled)(
	"capture tickets bind scope, store through real Keychain, expire and reject reuse",
	async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "yonder-capture-"))),
			store = new Store(root, { maxBytes: 65536, ttlSeconds: 3600 });
		let id: string | undefined;
		try {
			await store.ensure();
			await store.kernel.prepare(signal());
			const ticket = await store.ticket(scope);
			id = ticket.id;
			const value = randomBytes(40).toString("hex");
			const result = await capture(root, id, async () => value);
			expect(result.session).toBe(scope.session);
			await store.consume(result, signal(), async (data) => expect(data.toString() === value).toBe(true));
			await expect(capture(root, id, async () => value)).rejects.toThrow();
			const expired = await store.ticket(scope);
			await writeFile(
				store.path(expired.id, "tickets"),
				JSON.stringify({ ...expired, expiresAt: new Date(0).toISOString() }),
			);
			await expect(capture(root, expired.id, async () => value)).rejects.toThrow("expired");
		} finally {
			if (id) {
				const c = (await store.all()).find((c) => c.id === id);
				if (c) await store.drop(c, signal());
			}
			await rm(root, { recursive: true, force: true });
		}
	},
	120000,
);
test.skipIf(!enabled)(
	"actual PTY hidden capture never echoes generated secret and deletes its own Keychain item",
	async () => {
		const { stdout } = await run(
			"/usr/bin/python3",
			[resolve("plugins/clipboard/test/capture-pty.py"), resolve("plugins/clipboard/dist/capture.js")],
			{ timeout: 120000 },
		);
		expect(JSON.parse(stdout)).toEqual({ capture: true, hidden: true, exact: true, cleanup: true });
	},
	130000,
);
