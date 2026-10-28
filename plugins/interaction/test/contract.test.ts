import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import { CompanionService } from "../src/service.js";

it("satisfies the actual SDK plugin contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});
it("serves cards, returns actual answers only to their owner, and recovers persisted history", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-ui-"));
	const service = new CompanionService(directory, false, "en-US", "America/Caracas");
	const owner = { agent: "ui-test", session: "ui-test-session", profile: "default" };
	const signal = new AbortController().signal;
	await service.start();
	try {
		const first = await service.present(
			{
				id: "check",
				title: "交互验收",
				prompt: "选择下一步",
				kind: "choice",
				options: [{ id: "continue", label: "继续" }],
				next: { id: "note", title: "交互验收", prompt: "验收反馈", kind: "form" },
			},
			owner,
		);
		const second = await service.present(
			{ id: "second", title: "第二张", prompt: "填写反馈", kind: "form", autoClose: false },
			{ ...owner, session: "other" },
		);
		const post = (id: string, answer: string, step: number) =>
			fetch(`${service.url}answer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id, answer, step }),
			});
		expect((await fetch(`${service.url}state`)).status).toBe(200);
		const page = await (await fetch(service.url)).text();
		expect(page).toContain('"locale":"en-US","timezone":"America/Caracas"');
		expect(page).toContain("document.documentElement.lang=window.yonderSettings.locale");
		expect((await fetch(new URL("/state", service.url))).status).toBe(403);
		expect((await fetch(service.url, { headers: { Origin: "https://foreign.invalid" } })).status).toBe(403);
		await expect(service.result(first.id, { ...owner, session: "other" }, false, signal)).rejects.toThrow("belong");
		const waiting = service.result(first.id, owner, true, signal);
		expect((await post(second.id, "wrong current card", 0)).status).toBe(400);
		expect((await post(first.id, "continue", 0)).status).toBe(200);
		expect((await post(first.id, "continue", 0)).status).toBe(400);
		expect((await service.result(first.id, owner, false, signal)).status).toBe("pending");
		expect((await post(first.id, "浏览器到工具回传闭环", 1)).status).toBe(200);
		const completed = await waiting;
		expect(completed.status).toBe("completed");
		expect(completed.steps.map((s) => s.answer)).toEqual(["继续", "浏览器到工具回传闭环"]);
		expect((await (await fetch(`${service.url}state`)).json()).active.id).toBe(second.id);
		const controller = new AbortController();
		const cancelledWait = service.result(second.id, { ...owner, session: "other" }, true, controller.signal);
		controller.abort(new Error("test cancellation"));
		await expect(cancelledWait).rejects.toThrow("test cancellation");
		expect((await service.result(second.id, { ...owner, session: "other" }, false, signal)).status).toBe("pending");
		await service.closeSession("other");
		expect((await service.result(second.id, { ...owner, session: "other" }, false, signal)).status).toBe("cancelled");
		expect(JSON.parse(await readFile(join(directory, "interactions.json"), "utf8"))).toHaveLength(2);
		await service.stop();
		const restored = new CompanionService(directory, false);
		await restored.start();
		try {
			expect(await restored.result(first.id, owner, false, signal)).toEqual(completed);
			const state = await (await fetch(`${restored.url}state`)).json();
			expect(state.history).toHaveLength(2);
			expect(state.active).toBeNull();
		} finally {
			await restored.stop();
		}
	} finally {
		await service.stop();
	}
});

it("publishes one private desktop endpoint instead of launching a second application", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-ui-endpoint-"));
	const service = new CompanionService(directory, true);
	const path = join(directory, "desktop.json");
	await service.start();
	try {
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ url: service.url, pid: process.pid });
		// Windows does not expose POSIX permission bits.
		if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect((await fetch(service.url)).status).toBe(200);
	} finally {
		await service.stop();
	}
	await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	const browserOnly = new CompanionService(directory, false);
	await browserOnly.start();
	try {
		await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await browserOnly.stop();
	}
});
