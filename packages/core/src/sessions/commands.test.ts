import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { initHome, openKernel } from "../kernel/index.js";

test("session model commands persist, remain isolated, validate input and report native compact availability without inference", async () => {
	const home = await mkdtemp("/tmp/yonder-model-commands-");
	await initHome(home);
	await writeFile(
		`${home}/presets/command-owner.yaml`,
		"schema: 1\ndescription: Session command verification\nlevel: bypass\nmodel: openai/gpt-6-luna\n",
	);
	let kernel = await openKernel(home);
	try {
		const first = await kernel.sessions.open({ preset: "command-owner", close: "manual" });
		const second = await kernel.sessions.open({ preset: "command-owner", close: "manual" });
		const changed = await kernel.sessions.command(first.id, "model openai/gpt-6.1-sol openai/gpt-6-luna");
		expect(changed).toContain("openai/gpt-6.1-sol");
		expect(changed).toContain("连续失败 0 / 3");
		expect(changed).toContain("尚无可压缩");
		await kernel.sessions.command(first.id, "model effort high");
		await kernel.sessions.command(first.id, "model after 2");
		expect(await kernel.sessions.command(first.id, "status")).toContain("Effort: high");
		expect(await kernel.sessions.command(second.id, "model")).toContain("主模型: openai/gpt-6-luna");
		await expect(kernel.sessions.command(first.id, "model openai/no-such-model")).rejects.toThrow("Unknown model");
		await expect(kernel.sessions.command(first.id, "model after 0")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "model effort nope")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "compact")).rejects.toThrow("尚无可压缩");
		await kernel.close();
		kernel = await openKernel(home);
		expect(await kernel.sessions.command(first.id, "model")).toContain("连续失败 0 / 2");
		expect(await kernel.sessions.command(first.id, "model")).toContain("Effort: high");
		await kernel.sessions.command(first.id, "model reset");
		expect(await kernel.sessions.command(first.id, "model")).toContain("主模型: openai/gpt-6-luna");
		expect(await kernel.sessions.command(first.id, "model list openai")).toContain("openai/gpt-6.1-sol");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});
