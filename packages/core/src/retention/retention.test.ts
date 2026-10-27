import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRetention, defaultPolicy, validatePolicy } from "./index.js";

const temps: string[] = [];

async function tempHome(): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "yonder-retention-"));
	temps.push(home);
	return home;
}

afterEach(async () => {
	await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("日志轮转", () => {
	it("超过 maxBytes 就归档，且只保留 keep 份", async () => {
		const home = await tempHome();
		const logs = join(home, ".yonder", "logs");
		await mkdir(logs, { recursive: true });
		const policy = { ...defaultPolicy(home), logs: { dir: logs, maxBytes: 100, keep: 2 } };
		let clock = 1_700_000_000_000;
		const retention = createRetention({ home, policy, now: () => clock });
		for (let round = 1; round <= 4; round += 1) {
			await writeFile(join(logs, "harness.log"), `round-${round}\n`.repeat(20));
			clock += 60_000;
			const result = await retention.run();
			expect(result.logsRotated).toHaveLength(1);
		}
		const archives = (await readdir(logs)).filter((name) => name !== "harness.log").sort();
		expect(archives).toHaveLength(2);
		// 归档保留完整内容，最新一轮的原文可查。
		const newest = await readFile(join(logs, archives.at(-1) ?? ""), "utf8");
		expect(newest).toContain("round-4");
		// 活跃文件被截断而不是改名：写入方句柄仍然指向它，下一轮继续追加。
		expect((await stat(join(logs, "harness.log"))).size).toBe(0);
	});

	it("未超限的日志不动", async () => {
		const home = await tempHome();
		const logs = join(home, ".yonder", "logs");
		await mkdir(logs, { recursive: true });
		await writeFile(join(logs, "status.log"), "small\n");
		const result = await createRetention({ home }).run();
		expect(result.logsRotated).toEqual([]);
		expect(await readdir(logs)).toEqual(["status.log"]);
	});
});

describe("后台目录合并", () => {
	it("合并进滚动文件且内容不丢，目录清空", async () => {
		const home = await tempHome();
		const background = join(home, ".yonder", "background");
		await mkdir(join(background, "task-1"), { recursive: true });
		await mkdir(join(background, "task-2"), { recursive: true });
		await writeFile(join(background, "task-1", "stdout.log"), "alpha-output\n");
		await writeFile(join(background, "task-2", "stdout.log"), "beta-output\n");
		const result = await createRetention({ home }).run();
		expect(result.backgroundDirsRemoved).toBe(2);
		expect(result.backgroundBytesRemoved).toBeGreaterThan(0);
		expect(await readdir(background)).toEqual([]);
		const merged = await readFile(join(home, ".yonder", "background.log"), "utf8");
		expect(merged).toContain("alpha-output");
		expect(merged).toContain("beta-output");
		// 分隔行记录来源，合并后仍能定位是哪次任务的输出。
		expect(merged).toContain("task-1/stdout.log");
		expect(merged).toContain("task-2/stdout.log");
		expect(merged.indexOf("alpha-output")).toBeLessThan(merged.indexOf("beta-output"));
	});

	it("超过 keepDays 的目录直接回收，不写进滚动文件", async () => {
		const home = await tempHome();
		const background = join(home, ".yonder", "background");
		const stale = join(background, "stale");
		await mkdir(stale, { recursive: true });
		await writeFile(join(stale, "stdout.log"), "expired-output\n");
		const old = new Date(Date.now() - 40 * 86_400_000);
		await utimes(stale, old, old);
		const result = await createRetention({ home }).run();
		expect(result.backgroundDirsRemoved).toBe(1);
		expect(result.bytesReclaimed).toBeGreaterThan(0);
		expect(await readdir(background)).toEqual([]);
		await expect(readFile(join(home, ".yonder", "background.log"), "utf8")).rejects.toThrow();
	});

	it("预算用尽后停止处理并记录 skipped", async () => {
		const home = await tempHome();
		const background = join(home, ".yonder", "background");
		for (const name of ["a", "b", "c"]) {
			await mkdir(join(background, name), { recursive: true });
			await writeFile(join(background, name, "stdout.log"), `${name}-payload\n`.repeat(10));
		}
		const policy = { ...defaultPolicy(home), budgetBytes: 120 };
		const result = await createRetention({ home, policy }).run();
		expect(result.backgroundDirsRemoved).toBe(1);
		expect(result.skipped.some((item) => item.reason.includes("预算"))).toBe(true);
		expect((await readdir(background)).sort()).toEqual(["b", "c"]);
	});
});

describe("失败隔离", () => {
	it("单个文件失败只记 skipped，整轮继续", async () => {
		const home = await tempHome();
		const logs = join(home, ".yonder", "logs");
		await mkdir(join(logs, "broken.log"), { recursive: true });
		await writeFile(join(logs, "harness.log"), "x".repeat(4096));
		const policy = { ...defaultPolicy(home), logs: { dir: logs, maxBytes: 512, keep: 3 } };
		const result = await createRetention({ home, policy }).run();
		expect(result.logsRotated).toHaveLength(1);
		expect(result.skipped).toEqual([
			{ what: join(logs, "broken.log"), reason: expect.stringContaining("不是普通文件") },
		]);
		expect(await readdir(logs)).toContain("harness.log");
	});

	it("派生物回收抛错时记入 skipped 而不是抛出", async () => {
		const home = await tempHome();
		const result = await createRetention({
			home,
			compactDerived: async () => {
				throw new Error("db locked");
			},
		}).run();
		expect(result.skipped).toEqual([{ what: "derived", reason: "db locked" }]);
		expect(result.derivedCompacted).toBe(0);
	});
});

describe("调用约定", () => {
	it("并发 run() 共享同一轮，派生物回调只调一次", async () => {
		const home = await tempHome();
		let calls = 0;
		const budget = defaultPolicy(home).budgetBytes;
		const retention = createRetention({
			home,
			compactDerived: async (olderThanDays, budgetBytes) => {
				calls += 1;
				expect(olderThanDays).toBe(30);
				expect(budgetBytes).toBe(budget);
				return 7;
			},
		});
		const [first, second] = await Promise.all([retention.run(), retention.run()]);
		expect(calls).toBe(1);
		expect(first).toBe(second);
		expect(first.derivedCompacted).toBe(7);
	});

	it("policy() 返回副本，外部改动不影响引擎", async () => {
		const home = await tempHome();
		const retention = createRetention({ home });
		retention.policy().logs.keep = 99;
		expect(retention.policy().logs.keep).toBe(3);
	});
});

describe("validatePolicy", () => {
	it("接受默认策略的往返", () => {
		const policy = defaultPolicy("/tmp/yonder-home");
		expect(validatePolicy(policy)).toEqual(policy);
	});

	it("非法值给出带字段路径的错误", () => {
		const base = defaultPolicy("/tmp/yonder-home");
		expect(() => validatePolicy({ ...base, budgetBytes: -1 })).toThrow(/policy\.budgetBytes/);
		expect(() => validatePolicy({ ...base, logs: { ...base.logs, keep: 0 } })).toThrow(/policy\.logs\.keep/);
		expect(() => validatePolicy({ ...base, logs: { ...base.logs, dir: "" } })).toThrow(/policy\.logs\.dir/);
		expect(() => validatePolicy({ ...base, logs: { ...base.logs, maxBytes: 1.5 } })).toThrow(/整数/);
		expect(() => validatePolicy({ ...base, derived: { olderThanDays: "30" } })).toThrow(/policy\.derived/);
		expect(() => validatePolicy({ ...base, extra: true })).toThrow(/不是已知字段/);
	});

	it("拒绝把合并文件放进后台目录", () => {
		const base = defaultPolicy("/tmp/yonder-home");
		expect(() =>
			validatePolicy({
				...base,
				background: { ...base.background, mergedFile: join(base.background.dir, "background.log") },
			}),
		).toThrow(/mergedFile/);
	});
});
