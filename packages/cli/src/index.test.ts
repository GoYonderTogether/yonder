import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("CLI runs through the installed current symlink", async () => {
	const directory = await mkdtemp("/tmp/yonder-entry-");
	try {
		const entry = join(directory, "current");
		await symlink(resolve("packages/cli/dist/index.js"), entry);
		const result = JSON.parse(execFileSync(process.execPath, [entry, "version", "--json"], { encoding: "utf8" }));
		expect(result.version).toBeTruthy();
		expect(result.source).toBe(resolve("."));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("chat preserves JSONL final after progress and exits when the server disconnects", async () => {
	const home = await mkdtemp("/tmp/ychat-");
	const directory = join(home, ".yonder/plugins/channel-cli");
	await mkdir(directory, { recursive: true });
	const server = createServer((socket) =>
		socket.end(
			`${JSON.stringify({ type: "text", delta: "Working" })}\n${JSON.stringify({ type: "final", text: "Finished" })}\n`,
		),
	);
	try {
		await new Promise<void>((done) => server.listen(join(directory, "cli.sock"), done));
		const child = spawn(process.execPath, [
			resolve("packages/cli/dist/index.js"),
			"chat",
			"--channel",
			"cli",
			"--home",
			home,
			"--json",
		]);
		let out = "",
			err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		const code = await new Promise<number | null>((done) => child.once("exit", done));
		expect(code, err).toBe(0);
		expect(
			out
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
		).toEqual([
			{ type: "text", delta: "Working" },
			{ type: "final", text: "Finished" },
		]);
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
		await rm(home, { recursive: true, force: true });
	}
});
