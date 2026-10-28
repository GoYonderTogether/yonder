import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "../kernel/index.js";

test("session model commands persist, remain isolated, validate input and report native compact availability without inference", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	await initHome(home, "owner", { model: testModel });
	await writeFile(
		`${home}/presets/command-owner.yaml`,
		"schema: 1\ndescription: Session command verification\nlevel: bypass\nmodel: openai/gpt-6-luna\nthinking: medium\n",
	);
	let kernel = await openKernel(home);
	try {
		const first = await kernel.sessions.open({ preset: "command-owner", close: "manual" });
		const second = await kernel.sessions.open({ preset: "command-owner", close: "manual" });
		const changed = await kernel.sessions.command(first.id, "model openai/gpt-6.1-sol openai/gpt-6-luna");
		expect(changed).toContain("openai/gpt-6.1-sol");
		expect(changed).toContain("连续失败 0 / 3");
		expect(changed).toContain("尚无可压缩");
		const context = changed.match(/上下文估计: (\d+) \/ (\d+) tokens（([\d.]+)%）/);
		expect(context).not.toBeNull();
		expect(context?.[3]).toBe(((Number(context?.[1]) / Number(context?.[2])) * 100).toFixed(1));
		const legacy = await kernel.sessions.command(first.id, "model effort high");
		expect(legacy).toContain("最早 0.5 移除");
		expect(legacy).toContain("请改用 /effort");
		expect(await kernel.sessions.command(first.id, "effort")).toContain("Effort: high");
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
		await kernel.sessions.command(first.id, "effort auto");
		expect(await kernel.sessions.command(first.id, "effort")).toContain("Effort: medium");
		expect(await kernel.sessions.command(first.id, "model")).toContain("连续失败 0 / 2");
		expect(await kernel.sessions.command(first.id, "model")).toContain("主模型: openai/gpt-6.1-sol");
		await kernel.sessions.command(first.id, "effort low");
		expect(await kernel.sessions.command(first.id, "effort")).toContain("Effort: low");
		await expect(kernel.sessions.command(first.id, "effort invalid")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "effort reset")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "effort openai/gpt-6-luna")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "effort low extra")).rejects.toThrow("用法：/effort");
		await expect(kernel.sessions.command(first.id, "model effort openai/gpt-6-luna")).rejects.toThrow("无效模型设置");
		await expect(kernel.sessions.command(first.id, "model effort high extra")).rejects.toThrow("用法：/model");
		expect(await kernel.sessions.command(first.id, "model")).toContain("主模型: openai/gpt-6.1-sol");
		await kernel.sessions.command(first.id, "effort minimal");
		expect(await kernel.sessions.command(first.id, "effort")).toContain("Effort: low");
		await kernel.sessions.command(first.id, "model reset");
		expect(await kernel.sessions.command(first.id, "model")).toContain("主模型: openai/gpt-6-luna");
		expect(await kernel.sessions.command(first.id, "model list openai")).toContain("openai/gpt-6.1-sol");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("reading effort requires read, changing it requires admin", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	await initHome(home, "owner", { model: testModel });
	await writeFile(
		`${home}/presets/command-reader.yaml`,
		"schema: 1\ndescription: Read effort\nlevel: readonly\nmodel: openai/gpt-6-luna\n",
	);
	const kernel = await openKernel(home);
	try {
		const session = await kernel.sessions.open({ preset: "command-reader", close: "manual" });
		expect(await kernel.sessions.command(session.id, "effort")).toContain("Effort:");
		expect(JSON.parse(await kernel.sessions.command(session.id, "bg"))).toEqual([]);
		await expect(kernel.sessions.command(session.id, "bg logs 999999999")).rejects.toThrow("not found");
		await expect(kernel.sessions.command(session.id, "bg kill 999999999")).rejects.toThrow("admin");
		await expect(kernel.sessions.command(session.id, "effort high")).rejects.toThrow("admin");
		await expect(kernel.sessions.command(session.id, "effort auto")).rejects.toThrow("admin");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});
