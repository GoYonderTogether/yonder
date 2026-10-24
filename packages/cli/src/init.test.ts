import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parse } from "yaml";

const cli = resolve("packages/cli/dist/index.js");

function invoke(args: string[]) {
	return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("init generates the peer binding by default and omits it with --isolated", async () => {
	const root = await mkdtemp("/tmp/yonder-init-isolated-");
	try {
		const normalHome = join(root, "normal");
		const isolatedHome = join(root, "isolated");
		invoke(["init", normalHome, "--json"]);
		invoke(["init", isolatedHome, "--isolated", "--json"]);

		const readBindings = async (home: string) => {
			const config = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
			return config.bindings as Array<{ match?: { channel?: string; kind?: string } }>;
		};
		const normalBindings = await readBindings(normalHome);
		const isolatedBindings = await readBindings(isolatedHome);
		expect(
			normalBindings.some((binding) => binding.match?.channel === "agent" && binding.match?.kind === "agent"),
		).toBe(true);
		expect(
			isolatedBindings.some((binding) => binding.match?.channel === "agent" && binding.match?.kind === "agent"),
		).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("init help and shell completions advertise --isolated", () => {
	expect(invoke(["help"])).toContain("[--isolated]");
	for (const shell of ["zsh", "bash", "fish"])
		expect(invoke(["completion", shell])).toContain(shell === "fish" ? "-l isolated" : "--isolated");
});

test("init rejects unknown flags and does not consume --isolated as --owner's value", () => {
	for (const args of [
		["init", "--unknown"],
		["init", "--owner", "--isolated"],
	]) {
		try {
			invoke(args);
			throw new Error("expected CLI usage failure");
		} catch (error) {
			expect(error).toMatchObject({ status: 2 });
			if (args[1] === "--owner")
				expect((error as { stderr: Buffer }).stderr.toString()).toContain("init --owner requires an id");
		}
	}
});
