import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceSession } from "@yonder/protocol";
import { afterEach, expect, test } from "vitest";
import { canonicalHostPath, createHostProvider, HOST_TARGET, MAX_REMOTE_FILE_BYTES } from "../../src/backends/host.js";

const homes: string[] = [];
afterEach(async () => {
	await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function setup() {
	const home = await mkdtemp(join(tmpdir(), "yonder-host-actions-"));
	homes.push(home);
	const deviceId = randomUUID();
	const provider = createHostProvider(deviceId, "execution-only");
	const session: DeviceSession = {
		deviceId,
		deviceSessionId: randomUUID(),
		targetId: HOST_TARGET,
		principalId: "a".repeat(64),
		grantId: randomUUID(),
		grantRevision: 1,
		leaseEpoch: 1,
		capabilities: ["read", "write", "exec"],
		origin: { agentId: null, profileId: "test", modelSessionId: "test" },
		expiresAt: new Date(Date.now() + 30000).toISOString(),
	};
	const run = (name: string, args: Record<string, unknown>, signal = new AbortController().signal) =>
		provider.actions[name]!.execute({ ...args, scopeRoots: [home] }, { session, signal });
	return { home, provider, run };
}

test("real host files round-trip and symlinks cannot escape selected roots", async () => {
	const { home, provider, run } = await setup();
	const dir = join(home, "workspace"),
		file = join(dir, "input.txt");
	expect((await provider.describe()).targets.some((target) => target.id === HOST_TARGET)).toBe(true);
	await run("fs.mkdir", { path: dir });
	await run("fs.write", { path: file, dataBase64: Buffer.from("content").toString("base64") });
	expect(await run("fs.read", { path: file })).toEqual({ dataBase64: Buffer.from("content").toString("base64") });
	expect(await run("fs.stat", { path: file })).toMatchObject({ name: "input.txt", kind: "file", size: 7 });
	await run("fs.rename", { path: file, destination: join(dir, "renamed.txt") });
	expect(await run("fs.list", { path: dir })).toMatchObject([{ name: "renamed.txt", kind: "file" }]);
	expect(provider.actions["fs.write"]!.resources!({ path: join(dir, "new.txt") }).writeRoots).toEqual([
		join(canonicalHostPath(dir), "new.txt"),
	]);
	await run("fs.truncate", { path: join(dir, "renamed.txt"), size: 3 });
	await run("fs.flush", { path: join(dir, "renamed.txt") });
	expect(await readFile(join(dir, "renamed.txt"), "utf8")).toBe("con");
	const outside = await mkdtemp(join(tmpdir(), "yonder-host-outside-"));
	homes.push(outside);
	await writeFile(join(outside, "kept.txt"), "kept");
	await symlink(outside, join(dir, "outside"), process.platform === "win32" ? "junction" : "dir");
	expect(await run("fs.read", { path: join(dir, "outside", "kept.txt") })).toMatchObject({ error: { code: "EACCES" } });
	expect(await run("fs.write", { path: join(dir, "outside", "new.txt"), dataBase64: "YQ==" })).toMatchObject({
		error: { code: "EACCES" },
	});
	await run("fs.remove", { path: join(dir, "outside") });
	expect(await readFile(join(outside, "kept.txt"), "utf8")).toBe("kept");
	if (process.platform !== "win32") {
		await symlink(join(outside, "does-not-exist.txt"), join(dir, "broken"));
		expect(await run("fs.write", { path: join(dir, "broken"), dataBase64: "YQ==" })).toMatchObject({
			error: { code: "EACCES" },
		});
	}
	expect(
		await run("fs.rename", { path: join(dir, "renamed.txt"), destination: join(outside, "stolen.txt") }),
	).toMatchObject({ error: { code: "EACCES" } });
});

test("large reads fail explicitly and malformed operation arguments are rejected", async () => {
	const { home, provider, run } = await setup();
	const file = join(home, "large.bin");
	await writeFile(file, Buffer.alloc(MAX_REMOTE_FILE_BYTES + 1));
	expect(await run("fs.read", { path: file })).toMatchObject({ error: { code: "EFBIG" } });
	expect(provider.actions["fs.write"]!.validate({ path: file, dataBase64: "@@" })).toBe(false);
	expect(provider.actions["fs.stat"]!.validate({ path: "../relative" })).toBe(false);
	expect(provider.actions["process.exec"]!.validate({ command: [], cwd: home })).toBe(false);
	expect(provider.actions["process.exec"]!.validate({ command: "pwd", cwd: home, env: { KEY: 1 } })).toBe(false);
	expect(provider.actions["process.exec"]!.validate({ command: "pwd", cwd: home, timeout: -1 })).toBe(false);
	expect(await run("fs.read", { path: join(home, "missing") })).toMatchObject({ error: { code: "ENOENT" } });
});

test("real processes return stderr/nonzero exits and preserve full large output in a spill file", async () => {
	const { home, run } = await setup();
	expect(
		await run("process.exec", {
			command: [
				process.execPath,
				"-e",
				"process.stdout.write(process.env.CHECK); process.stderr.write('diagnostic'); process.exit(7)",
			],
			cwd: home,
			env: { CHECK: "literal" },
		}),
	).toMatchObject({ exitCode: 7, stdout: "literal", stderr: "diagnostic" });
	const result = (await run("process.exec", {
		command: [process.execPath, "-e", "process.stdout.write('x'.repeat(400000))"],
		cwd: home,
	})) as { stdout: string; spillPath: string };
	expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(128 * 1024);
	expect(
		(await readFile(result.spillPath, "utf8"))
			.replaceAll("[stdout]", "")
			.replaceAll("[stderr]", "")
			.replaceAll("\n", ""),
	).toBe("x".repeat(400000));
});

test("cancellation settles after the owned subprocess tree stops", async () => {
	const { home, run } = await setup();
	const ready = join(home, "ready"),
		late = join(home, "late");
	const abort = new AbortController();
	const pending = run(
		"process.exec",
		{
			cwd: home,
			command: [
				process.execPath,
				"-e",
				"require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>require(\"node:fs\").writeFileSync(process.argv[1],\"late\"), 1000)', process.argv[2]], {stdio:'ignore'}); require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(()=>{},1000)",
				ready,
				late,
			],
		},
		abort.signal,
	);
	const result = pending.catch((error) => error);
	await expect
		.poll(async () => {
			try {
				await access(ready);
				return true;
			} catch {
				return false;
			}
		})
		.toBe(true);
	abort.abort();
	expect(await result).toBeInstanceOf(Error);
	await new Promise((done) => setTimeout(done, 1100));
	await expect(access(late)).rejects.toThrow();
});
