import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStatusSurface, type StatusSource } from "./index.js";

let home = "";
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "yonder-status-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

function source(initial: { reads: number; watermark: string }) {
	const state = { ...initial };
	const read = async () => {
		state.reads += 1;
		return { ready: true, version: "1.0.0", active: 0, agents: [{ id: "a", state: "idle" }] };
	};
	const port: StatusSource = {
		read,
		watermark: async () => state.watermark,
	};
	return { state, port };
}

describe("状态面", () => {
	it("水位不变时不重算，也不重写文件", async () => {
		const { state, port } = source({ reads: 0, watermark: "1" });
		const surface = createStatusSurface({ home, source: port });
		await surface.refresh();
		const first = await readFile(surface.path, "utf8");
		// 手动再刷新一次：内容相同，publisher 应拒绝写入。
		await surface.refresh();
		expect(state.reads).toBe(2);
		expect(await readFile(surface.path, "utf8")).toBe(first);
	});

	it("内容变化时递增 revision 并落盘", async () => {
		let version = "1.0.0";
		const surface = createStatusSurface({
			home,
			source: {
				read: async () => ({ ready: true, version, active: 0, agents: [] }),
				watermark: async () => "1",
			},
		});
		const a = await surface.refresh();
		version = "2.0.0";
		const b = await surface.refresh();
		expect(b!.revision).toBe(a!.revision + 1);
		const file = JSON.parse(await readFile(surface.path, "utf8"));
		expect(file.version).toBe("2.0.0");
		expect(file.revision).toBe(b!.revision);
	});

	it("心跳会在内容不变时刷新 observedAt", async () => {
		let clock = 1_000_000;
		const surface = createStatusSurface({
			home,
			source: {
				read: async () => ({ ready: true, version: "1.0.0", active: 0, agents: [] }),
				watermark: async () => 1,
			},
			now: () => clock,
			heartbeatMs: 10_000,
		});
		await surface.refresh();
		const first = JSON.parse(await readFile(surface.path, "utf8"));
		clock += 12_000;
		// force=false：内容相同，但已过心跳窗口，应仍然写盘。
		await surface.refresh(true);
		const second = JSON.parse(await readFile(surface.path, "utf8"));
		expect(second.observedAt).toBe(clock);
		expect(second.revision).toBe(first.revision);
	});

	it("start 后按水位推进自动重算，stop 之后不再动", async () => {
		const { state, port } = source({ reads: 0, watermark: "1" });
		const surface = createStatusSurface({ home, source: port, intervalMs: 10 });
		surface.start();
		await new Promise((resolve) => setTimeout(resolve, 30));
		const afterStart = state.reads;
		expect(afterStart).toBe(1); // 水位没变，只算了一次
		state.watermark = "2";
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(state.reads).toBe(2);
		await surface.stop();
		state.watermark = "3";
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(state.reads).toBe(2);
	});
});
