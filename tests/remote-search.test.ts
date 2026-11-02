import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceSession } from "@yonder/protocol";
import { createRemoteEnvironment } from "@yonder/runtime-adapter/node/runtime/remote-env";
import { remoteFind, remoteGrep } from "@yonder/runtime-adapter/node/runtime/remote-search";
import { createFindTool } from "@yonder/runtime-adapter/runtime/find";
import { createGrepTool } from "@yonder/runtime-adapter/runtime/grep";
import type { ToolContext } from "@yonder/sdk";
import { afterEach, expect, test } from "vitest";
import { createHostProvider, HOST_TARGET } from "../packages/device/src/backends/host.js";

const homes: string[] = [];
afterEach(async () => {
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function setup() {
	const home = await realpath(await mkdtemp(join(tmpdir(), "yonder-remote-search-")));
	homes.push(home);
	const deviceId = randomUUID(),
		provider = createHostProvider(deviceId, "execution-only");
	const calls: string[] = [];
	const session: DeviceSession = {
		deviceId,
		deviceSessionId: randomUUID(),
		targetId: HOST_TARGET,
		principalId: "a".repeat(64),
		grantId: randomUUID(),
		grantRevision: 1,
		leaseEpoch: 1,
		capabilities: ["read"],
		origin: { agentId: null, profileId: "test", modelSessionId: "test" },
		expiresAt: new Date(Date.now() + 60000).toISOString(),
	};
	const env = createRemoteEnvironment(deviceId, home, async (action, args, context) => {
		calls.push(action);
		if (!["fs.stat", "fs.canonical", "fs.list", "fs.read"].includes(action)) throw new Error("readonly: denied");
		return provider.actions[action]!.execute(
			{ ...args, scopeRoots: [home] },
			{ session, signal: context.abortSignal ?? new AbortController().signal },
		);
	});
	const ctx: ToolContext = {
		agent: null,
		profile: "readonly",
		session: "test",
		capabilities: ["read", "network"],
		env,
		signal: new AbortController().signal,
	};
	return { home, ctx, calls };
}

test("remote readonly find/grep read real files, preserve anchors and ignore nested excluded paths without exec", async () => {
	const { home, ctx, calls } = await setup();
	await mkdir(join(home, "src"));
	await mkdir(join(home, ".hidden"));
	await mkdir(join(home, ".git"));
	await writeFile(join(home, "src/a.ts"), "before\nHello 世界\nafter\n");
	await writeFile(join(home, "src/ignored.ts"), "Hello");
	await writeFile(join(home, "src/.gitignore"), "ignored.ts\n");
	await writeFile(join(home, ".hidden/b.ts"), "Hello");
	await writeFile(join(home, ".git/secret.ts"), "Hello");
	await writeFile(join(home, "binary.bin"), Buffer.from([0, 72, 101, 108, 108, 111]));
	const found = await createFindTool(remoteFind).execute({ pattern: "*.ts" }, ctx);
	expect(found.text.split("\n").sort()).toEqual([".hidden/b.ts", "src/a.ts"]);
	const grep = await createGrepTool(remoteGrep).execute(
		{ pattern: "hello", ignoreCase: true, context: 1, glob: "*.ts" },
		ctx,
	);
	// Display headers use forward slashes; filesystem operations and anchor keys retain native canonical paths.
	expect(grep.text.split("\n")[0]).toBe(`=== ${join(home, "src/a.ts").replaceAll("\\", "/")} ===`);
	expect(grep.text).toMatch(/2:│ [a-z]{5}│Hello 世界/);
	expect(grep.text).toMatch(/1-│ [a-z]{5}│before/);
	expect(grep.text).not.toContain("ignored");
	expect(grep.text).not.toContain(".hidden");
	expect(calls).not.toContain("process.exec");
	expect(
		(await createGrepTool(remoteGrep).execute({ pattern: "Hello 世界", literal: true, path: "src/a.ts" }, ctx)).text,
	).toContain("Hello 世界");
	expect((await createFindTool(remoteFind).execute({ pattern: "*.ts", limit: 1 }, ctx)).text).toContain(
		"output limited",
	);
});

test("remote searches enforce grant scope, skip symlinks and report bounded files", async () => {
	const { home, ctx } = await setup();
	const outside = await realpath(await mkdtemp(join(tmpdir(), "yonder-search-outside-")));
	homes.push(outside);
	await writeFile(join(outside, "secret.txt"), "secret");
	await symlink(outside, join(home, "escape"), process.platform === "win32" ? "junction" : "dir");
	await writeFile(join(home, "large.txt"), "x".repeat(512 * 1024 + 1));
	expect((await createGrepTool(remoteGrep).execute({ pattern: "secret" }, ctx)).text).toContain("skipped 1 files");
	await expect(
		createGrepTool(remoteGrep).execute({ pattern: "secret", path: join(home, "escape") }, ctx),
	).rejects.toThrow();
	await expect(createFindTool(remoteFind).execute({ pattern: "*", path: outside }, ctx)).rejects.toThrow();
	const aborted = { ...ctx, signal: AbortSignal.abort() };
	await expect(createFindTool(remoteFind).execute({ pattern: "*" }, aborted)).rejects.toBeDefined();
});

test("remote regex errors and expensive expressions fail explicitly without blocking runtime", async () => {
	const { home, ctx } = await setup();
	await writeFile(join(home, "bad.txt"), "a".repeat(10000) + "!");
	await expect(createGrepTool(remoteGrep).execute({ pattern: "[" }, ctx)).rejects.toThrow();
	await expect(createGrepTool(remoteGrep).execute({ pattern: "(a+)+$" }, ctx)).rejects.toThrow("exceeded 1 second");
}, 10000);
