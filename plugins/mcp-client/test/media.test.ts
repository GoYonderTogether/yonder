import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

type Run = { code: number | string | null; signal: string | null; stdout: string; stderr: string };

const script = fileURLToPath(new URL("./media.mjs", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));

it("runs the local MCP media mapping script to exit 0", async () => {
	const run = await new Promise<Run>((resolve) => {
		execFile(process.execPath, [script], { cwd: root, timeout: 110_000 }, (error, stdout, stderr) =>
			resolve({ code: error ? (error.code ?? null) : 0, signal: error?.signal ?? null, stdout, stderr }),
		);
	});
	expect(
		run.code,
		`exit code ${run.code} signal ${run.signal}\n--- stdout ---\n${run.stdout}\n--- stderr ---\n${run.stderr}`,
	).toBe(0);
}, 120_000);
