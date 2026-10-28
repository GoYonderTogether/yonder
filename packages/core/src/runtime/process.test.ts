import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const { processTool } = await import("./process.js");
	const jobs = new Map<number, { output: string; write?: (text: string, eof?: boolean) => Promise<void> }>();
	const tool = processTool(home, jobs);
	let id = 0;
	return {
		home,
		run(args: Record<string, unknown>, controller = new AbortController()) {
			const taskId = ++id;
			jobs.set(taskId, { output: "" });
			const api = {
				taskId,
				conversationId: 1,
				env: { id: "node:local", cwd: home },
				output() {},
			} as unknown as ToolExecutionApi;
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
test("truncated bash output is indexed with its complete original", async () => {
	const f = await fixture();
	try {
		const result = await f.run({ command: "printf 'BEGIN\\n'; head -c 70000 /dev/zero | tr '\\0' x; printf 'END\\n'" });
		const item = result.output?.[0];
		if (!item || item.type !== "text") throw new Error("bash returned no text result");
		const value = JSON.parse(item.text);
		const path = value.cache.split("; ")[0];
		expect(await readFile(path, "utf8")).toBe(`BEGIN\n${"x".repeat(70000)}END\n`);
		expect(await readFile(join(f.home, "cache/tool-output/1/index.jsonl"), "utf8")).toContain(path);
	} finally {
		await f.close();
	}
});
test("bash reports cache failure without claiming a readable cache", async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.home, "cache"));
		await writeFile(join(f.home, "cache/tool-output.json"), "invalid");
		const result = await f.run({ command: "head -c 70000 /dev/zero | tr '\\0' x" });
		const item = result.output?.[0];
		if (item?.type !== "text") throw new Error("bash returned no text result");
		const value = JSON.parse(item.text);
		expect(value.cache).toBe("Cache unavailable.");
		expect(value.exitCode).toBe(0);
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
