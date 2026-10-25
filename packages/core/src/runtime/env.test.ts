import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});
test("explicitly unhosted local exec keeps string and literal argv Result/stream semantics", async () => {
	vi.stubEnv("YONDER_SERVICE_REGISTRATION", undefined);
	vi.stubEnv("YONDER_SERVICE_COMMAND_FD", undefined);
	const { localEnvironment } = await import("./env.js");
	const home = await mkdtemp("/tmp/yonder-local-exec-");
	const env = localEnvironment(home);
	try {
		let text = "";
		const result = await env.exec(
			[process.execPath, "-e", "process.stdout.write(process.argv[1]);process.exit(7)", "a b;$(literal)"],
			{
				onOutput: (chunk) => {
					text += chunk;
				},
			},
			BACKGROUND_CONTEXT,
		);
		expect(result).toEqual({ ok: true, value: { exitCode: 7 } });
		expect(text).toBe("a b;$(literal)");
		expect(await env.exec("exit 3", undefined, BACKGROUND_CONTEXT)).toEqual({ ok: true, value: { exitCode: 3 } });
	} finally {
		await env.cleanup(BACKGROUND_CONTEXT);
		await rm(home, { recursive: true, force: true });
	}
});
test.skipIf(process.platform !== "darwin")(
	"hosted capability failure is shared and sticky across local exec and bash",
	async () => {
		const home = await mkdtemp("/tmp/yonder-local-exec-invalid-");
		try {
			vi.stubEnv("YONDER_SERVICE_REGISTRATION", join(home, "missing-registration"));
			vi.stubEnv("YONDER_SERVICE_COMMAND_FD", undefined);
			const { localEnvironment } = await import("./env.js");
			expect(() => localEnvironment(home)).toThrow("capability");
			vi.stubEnv("YONDER_SERVICE_REGISTRATION", undefined);
			const { hostedProcessSpawner } = await import("./hosted-process.js");
			expect(hostedProcessSpawner).toThrow("capability");
			await expect(access(join(home, "must-not-execute"))).rejects.toThrow();
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
);
