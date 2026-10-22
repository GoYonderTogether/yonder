import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type LoginProvider = "anthropic" | "openai" | "google" | "openrouter";
const providers = new Set<string>(["anthropic", "openai", "google", "openrouter"]);

function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function createLoginWrapper(input: {
	nodeExecutable: string;
	cliEntry: string;
	home: string;
	provider: string;
}): Promise<{ wrapperPath: string; resultPath: string }> {
	if (!providers.has(input.provider)) throw new Error("Unsupported login provider");
	const directory = await mkdtemp(join(tmpdir(), "yonder-login-"));
	await chmod(directory, 0o700);
	const wrapperPath = join(directory, "login.command");
	const resultPath = join(directory, "result.json");
	const temporaryResult = join(directory, "result.tmp");
	const script = `#!/bin/bash\numask 077\n${quote(input.nodeExecutable)} ${quote(input.cliEntry)} login ${quote(input.provider)} --home ${quote(input.home)}\ncode=$?\nprintf '{"status":"complete","code":%s}\\n' "$code" > ${quote(temporaryResult)}\nmv ${quote(temporaryResult)} ${quote(resultPath)}\nexit "$code"\n`;
	await writeFile(wrapperPath, script, { mode: 0o700, flag: "wx" });
	await chmod(wrapperPath, 0o700);
	return { wrapperPath, resultPath };
}
