import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { afterEach, expect, test, vi } from "vitest";

// Transport/API contract fixtures execute the actual tool and OS bash, no model.
afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});
async function fixture() {
	vi.stubEnv("YONDER_SERVICE_REGISTRATION", undefined);
	vi.stubEnv("YONDER_SERVICE_COMMAND_FD", undefined);
	const home = await mkdtemp("/tmp/yonder-process-tool-");
	const { processTool } = await import("./process.js");
	const jobs = new Map<number, { output: string; write?: (text: string, eof?: boolean) => Promise<void> }>();
	const tool = processTool(home, jobs);
	let id = 0;
	return {
		home,
		run(args: Record<string, unknown>, controller = new AbortController()) {
			const taskId = ++id;
			jobs.set(taskId, { output: "" });
			const api = { taskId, env: { id: "node:local", cwd: home }, output() {} } as unknown as ToolExecutionApi;
			return tool.execute(args, api, withAbortSignal(controller.signal, BACKGROUND_CONTEXT));
		},
		close: () => rm(home, { recursive: true, force: true }),
	};
}
test("explicitly unhosted bash retains real output and nonzero exit", async () => {
	const f = await fixture();
	try {
		const result = await f.run({ command: "printf actual; printf error >&2; exit 7" });
		const item = result.output?.[0];
		if (!item || item.type !== "text") throw new Error("bash returned no text result");
		const value = JSON.parse(item.text);
		expect(value.exitCode).toBe(7);
		expect(value.signal).toBeNull();
		expect(value.output).toContain("actual");
		expect(value.stderr).toBe("error");
		expect(await readFile(value.fullOutputPath, "utf8")).toBe(value.output);
	} finally {
		await f.close();
	}
});
test.skipIf(process.platform !== "darwin")(
	"host marker without private capability rejects, never executes or silently falls back",
	async () => {
		const f = await fixture();
		try {
			vi.stubEnv("YONDER_SERVICE_REGISTRATION", join(f.home, "missing-socket"));
			await expect(f.run({ command: "touch should-not-exist" })).rejects.toThrow("capability");
			// The broken capability is sticky even if mutable environment is removed.
			vi.stubEnv("YONDER_SERVICE_REGISTRATION", undefined);
			await expect(f.run({ command: "touch should-not-exist" })).rejects.toThrow("capability");
			await expect(access(join(f.home, "should-not-exist"))).rejects.toThrow();
		} finally {
			await f.close();
		}
	},
);
