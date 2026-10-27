import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, it } from "vitest";
import { fixture } from "../../tasks/test/board-fixture.js";
import { CompanionService } from "../src/service.js";
import { browser, chromePath } from "./browser.js";

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
		expect((await stat(path)).mode & 0o777).toBe(0o600);
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

it.skipIf(!existsSync(chromePath))(
	"renders a real published ledger, detail and automatic updates in the existing page",
	async () => {
		const f = await fixture({ stallMinutes: 0.000001 }, { ui: true });
		let page: Awaited<ReturnType<typeof browser>> | undefined;
		try {
			const input = {
				title: "Verify task board",
				objective: "Inspect the real local board",
				acceptance: ["Groups visible", "Detail visible"],
				nonGoals: [],
			};
			const task = f.store.open(input, f.ctx);
			f.store.update(task.ref, { state: "active" }, f.ctx);
			f.store.update(task.ref, { state: "waiting-user" }, f.ctx);
			const child = f.store.open({ ...input, title: "Nested acceptance", parent: task.id }, f.ctx);
			f.store.update(child.id, { state: "active" }, f.ctx);
			const blocked = f.store.open({ ...input, title: "Blocked check" }, f.ctx);
			f.store.update(blocked.id, { state: "active" }, f.ctx);
			f.store.update(blocked.id, { state: "blocked" }, f.ctx);
			const done = f.store.open({ ...input, title: "Completed check" }, f.ctx);
			f.store.update(done.id, { state: "active" }, f.ctx);
			f.store.update(done.id, { state: "review" }, f.ctx);
			f.store.done(done.id, "Protocol checked", ["HTTP 200", "DOM inspected"], f.ctx);
			const foreign = f.store.open({ ...input, title: "Foreign private task" }, { ...f.ctx, agent: "foreign" });
			const own = { ...f.ctx, capabilities: ["read"] };
			const shown = await f.call("show", { target: "web" }, own);
			expect(shown.isError).not.toBe(true);
			const { url } = JSON.parse(shown.text);
			expect((await fetch(url)).status).toBe(200);
			const published = await (await fetch(`${url}board`)).json();
			expect(published.board.counts).toEqual({ waiting: 1, inProgress: 1, blocked: 1 });
			expect(JSON.stringify(published)).not.toContain(foreign.id);
			expect((await fetch(`${url}board?id=${foreign.id}`)).status).toBe(400);
			const detail = await (await fetch(`${url}board?id=${done.ref}`)).json();
			expect(detail.board.detail.task.evidence).toEqual(["HTTP 200", "DOM inspected"]);
			page = await browser();
			expect(await page.command("Page.navigate", { url })).not.toHaveProperty("errorText");
			await page.wait('document.querySelector("#board-content")?.textContent.includes("1 等你")');
			expect(
				await page.evaluate(
					'[...document.querySelectorAll("#board-content > [data-group]")].map(n => n.dataset.group)',
				),
			).toEqual(["waiting", "inProgress", "blocked", "done"]);
			expect(await page.evaluate(`document.querySelectorAll('[data-task="${child.id}"]').length`)).toBe(1);
			expect(
				await page.evaluate(`document.querySelector('[data-group="inProgress"] [data-task="${child.id}"]') !== null`),
			).toBe(true);
			expect(await page.evaluate('document.querySelector("details[data-group=done]").open')).toBe(false);
			expect(await page.evaluate('document.querySelector("#board-count").textContent')).toBe("1");
			expect(await page.evaluate('document.querySelector(".board-stalled").textContent')).toContain("长时间无进展");
			await page.evaluate("window.yonderUI.activity({known:true, pinned:true, agents:[]})");
			expect(await page.evaluate('document.querySelector("#pin-button").getAttribute("aria-pressed")')).toBe("true");
			await page.evaluate("window.yonderUI.current()");
			expect(await page.evaluate('document.querySelector("#board-view").hidden')).toBe(false);
			await page.evaluate('document.querySelector("#close").click()');
			expect(await page.evaluate('document.querySelector("#reopen").hidden')).toBe(false);
			await page.evaluate('document.querySelector("#reopen").click()');
			if (process.env.YONDER_BOARD_SCREENSHOT) {
				const shot = await page.command("Page.captureScreenshot", { format: "png" });
				await writeFile(
					process.env.YONDER_BOARD_SCREENSHOT.replace(".png", "-overview.png"),
					Buffer.from(shot.data, "base64"),
				);
			}
			await page.evaluate('document.querySelector(".board-task").click()');
			await page.wait('document.querySelector("#board-content")?.textContent.includes("Inspect the real local board")');
			expect(await page.evaluate('document.querySelector("#board-content").textContent')).toContain("事件时间线");
			expect(await page.evaluate('document.querySelector("#board-content").textContent')).toContain(child.ref);
			await page.evaluate('document.querySelector(".panel-scroll").scrollTop = 80');
			f.store.update(task.id, { state: "active", note: "Continue verification" }, f.ctx);
			await page.wait('document.querySelector("#board-content")?.textContent.includes("Continue verification")');
			expect(await page.evaluate('document.querySelector(".panel-scroll").scrollTop')).toBe(80);
			await page.evaluate('document.querySelector("#board-back").click()');
			await page.wait('document.querySelector("#board-content")?.textContent.includes("0 等你")');
			expect(await page.evaluate(`document.querySelectorAll('[data-task="${child.id}"]').length`)).toBe(1);
			expect(
				await page.evaluate(
					`document.querySelector('[data-task="${task.id}"]').parentElement.querySelector('[data-task="${child.id}"]') !== null`,
				),
			).toBe(true);
			const desktop = await f.call("show", { target: "desktop", view: "detail", id: done.ref }, own);
			expect(JSON.parse(desktop.text).view).toBe("detail");
			await page.wait('document.querySelector("#board-content")?.textContent.includes("Protocol checked")');
			if (process.env.YONDER_BOARD_SCREENSHOT) {
				const shot = await page.command("Page.captureScreenshot", { format: "png" });
				await writeFile(process.env.YONDER_BOARD_SCREENSHOT, Buffer.from(shot.data, "base64"));
			}
		} finally {
			await page?.close();
			await f.close();
		}
	},
	20000,
);
