import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { completion } from "./completion.js";

const cli = resolve("packages/cli/dist/index.js");
test("shell-native scripts load and offer actual command/subcommand candidates", async () => {
	const directory = await mkdtemp("/tmp/ycomp-");
	try {
		await writeFile(`${directory}/bash`, completion("bash"));
		await writeFile(`${directory}/zsh`, completion("zsh"));
		const bash = execFileSync(
			"bash",
			[
				"-c",
				`source '${directory}/bash'; COMP_WORDS=(yonder se); COMP_CWORD=1; _yonder; printf '%s\\n' "\${COMPREPLY[@]}"`,
			],
			{ encoding: "utf8" },
		);
		expect(bash).toContain("sessions");
		const zsh = execFileSync(
			"zsh",
			[
				"-c",
				`autoload -Uz compinit; compinit -D -d '${directory}/zcomp'; source '${directory}/zsh'; compadd() { print -rl -- "$@"; }; words=(yonder service ''); CURRENT=3; _yonder`,
			],
			{ encoding: "utf8" },
		);
		expect(zsh).toContain("restart");
		for (const shell of ["bash", "zsh", "fish"]) {
			expect(completion(shell)).toContain("submit notify");
			expect(completion(shell)).toContain("channels");
			expect(completion(shell)).toContain("list login");
			expect(completion(shell)).toContain(shell === "fish" ? "-l isolated" : "--isolated");
		}
		const data = JSON.parse(
			execFileSync(process.execPath, [cli, "completion", "zsh", "--home", directory, "--json"], { encoding: "utf8" }),
		);
		expect(data.script).toContain("#compdef yonder");
		expect(data.candidates).toEqual({ sessions: [], presets: [], channels: [] });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("chat target conflicts are usage errors and help remains bilingual", () => {
	try {
		execFileSync(process.execPath, [cli, "chat", "--preset", "default", "--session", "2"], { stdio: "pipe" });
		throw new Error("expected failure");
	} catch (error) {
		expect((error as { status: number }).status).toBe(2);
	}
	expect(execFileSync(process.execPath, [cli, "help"], { encoding: "utf8" })).toContain("原生终端聊天");
});
