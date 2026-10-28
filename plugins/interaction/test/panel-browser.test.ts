import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fixture } from "../../tasks/test/board-fixture.js";
import { browser, chromePath } from "./browser.js";

test.skipIf(!existsSync(chromePath))(
	"real Store → caller → board → companion: compact accordion, grouping, keyboard, avatars, privacy and dedup",
	async () => {
		const avatarUrl = process.env.YONDER_PANEL_AVATAR;
		const f = await fixture({}, { ui: true, ...(avatarUrl ? { avatarUrl } : {}) });
		let page: Awaited<ReturnType<typeof browser>> | undefined;
		const output = process.env.YONDER_UI_PREVIEW;
		const input = {
			title: "测试 · 核对小弹窗任务板",
			objective: "测试预览，确认任务展示，不是实际主人任务。",
			acceptance: ["PRIVATE-LONG-ACCEPTANCE", "PRIVATE-EVIDENCE"],
			nonGoals: [],
		};
		try {
			const task = f.store.open(input, f.ctx);
			f.store.update(task.id, { state: "active" }, f.ctx);
			f.store.update(task.id, { state: "waiting-user", note: "请检查测试文档中的标题，确认后回复。" }, f.ctx);
			const child = f.store.open(
				{ ...input, title: "测试 · 检查窄窗下超长标题不会横向溢出并且不修改账本中原本的标题内容", parent: task.id },
				{ ...f.ctx, agent: "worker" },
			);
			f.store.update(child.id, { state: "active" }, { ...f.ctx, agent: "worker" });
			const blocked = f.store.open({ ...input, title: "测试 · 补齐图片许可记录" }, f.ctx);
			f.store.update(blocked.id, { state: "active" }, f.ctx);
			f.store.update(blocked.id, { state: "blocked", note: "测试来源页缺少许可说明，等待提供实际来源。" }, f.ctx);
			const review = f.store.open({ ...input, title: "测试 · 待检查键盘交互" }, f.ctx);
			f.store.update(review.id, { state: "active" }, f.ctx);
			f.store.update(review.id, { state: "review", note: "测试检查已写入，待检查实际交互结果。" }, f.ctx);
			const done = f.store.open({ ...input, title: "测试 · 已核对状态标签" }, f.ctx);
			f.store.update(done.id, { state: "active" }, f.ctx);
			f.store.update(done.id, { state: "review" }, f.ctx);
			f.store.done(done.id, "测试标签核对完成", ["HTTP 200", "DOM asserted"], f.ctx);
			const cancelled = f.store.open({ ...input, title: "测试 · 已取消旧布局候选" }, f.ctx);
			f.store.update(cancelled.id, { state: "cancelled" }, f.ctx);
			const parent = f.store.open({ ...input, title: "测试 · 父项已结束但子项尚未完成" }, f.ctx);
			const live = f.store.open({ ...input, title: "测试 · 子项仍待检查", parent: parent.id }, f.ctx);
			f.store.update(live.id, { state: "active" }, f.ctx);
			f.store.update(live.id, { state: "review" }, f.ctx);
			f.store.update(parent.id, { state: "active" }, f.ctx);
			f.store.update(parent.id, { state: "review" }, f.ctx);
			f.store.done(parent.id, "测试父项已结束", ["Parent only", "Child distinct"], f.ctx);
			const foreign = f.store.open({ ...input, title: "FOREIGN-PRIVATE" }, { ...f.ctx, agent: "foreign" });
			const own = { ...f.ctx, capabilities: ["read"] as typeof f.ctx.capabilities };
			const shown = await f.call("show", { target: "web" }, own);
			expect(shown.isError).not.toBe(true);
			const { url } = JSON.parse(shown.text);
			const published = await (await fetch(`${url}board?view=panel`)).json();
			expect(published.panel.tasks).toHaveLength(8);
			expect(JSON.stringify(published)).not.toContain(foreign.id);
			expect((await fetch(`${url}board?id=${foreign.id}`)).status).toBe(400);
			expect((await fetch(new URL("/board", url))).status).toBe(403);
			page = await browser();
			await page.command("Emulation.setDeviceMetricsOverride", {
				width: 390,
				height: 760,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await page.command("Emulation.setEmulatedMedia", {
				features: [{ name: "prefers-reduced-motion", value: "reduce" }],
			});
			await page.command("Page.navigate", { url });
			await page.wait('document.querySelectorAll("[data-task]").length === 8');
			await page.evaluate(
				`document.querySelector('.preview-bar').hidden=false;document.querySelector('.preview-bar').innerHTML='<strong>测试预览 · 未装机</strong>';document.querySelector('#panel').style.top='64px';document.querySelector('#panel').style.height='650px'`,
			);
			const assertOnce = async () => {
				expect(
					await page!.evaluate('[...document.querySelectorAll("[data-task]")].map(n=>n.dataset.task).sort()'),
				).toEqual([task, child, blocked, review, done, cancelled, parent, live].map((t) => t.id).sort());
				expect(
					await page!.evaluate('document.querySelectorAll("[data-task][aria-expanded=true]").length'),
				).toBeLessThanOrEqual(1);
				expect(
					await page!.evaluate('document.querySelector("#board-content").textContent.includes("FOREIGN-PRIVATE")'),
				).toBe(false);
			};
			await assertOnce();
			expect(await page.evaluate('document.querySelector("[data-focus-key=bot]").getAttribute("aria-pressed")')).toBe(
				"true",
			);
			expect(await page.evaluate('[...document.querySelectorAll(".ended-section")].every(n=>!n.open)')).toBe(true);
			expect(await page.evaluate(`document.querySelector('[data-task="${review.id}"]').textContent`)).toContain(
				"待检查",
			);
			expect(await page.evaluate(`document.querySelector('[data-task="${task.id}"]').textContent`)).toContain("需要你");
			expect(
				await page.evaluate(`document.querySelector('[data-task="${child.id}"]').getBoundingClientRect().height`),
			).toBeLessThan(45);
			if (avatarUrl)
				await page.wait(
					'Boolean(document.querySelector(".bot-avatar img")?.complete && document.querySelector(".bot-avatar img")?.naturalWidth > 0)',
				);
			expect(
				await page.evaluate('[...document.querySelectorAll(".bot-avatar")].some(n=>n.textContent.includes("w"))'),
			).toBe(true);
			const screenshots: string[] = [];
			const shot = async (name: string) => {
				if (output) {
					await mkdir(output, { recursive: true });
					const data = await page!.command("Page.captureScreenshot", { format: "png" });
					await writeFile(join(output, name), Buffer.from(data.data, "base64"));
					screenshots.push(name);
				}
			};
			const key = async (name: string, code: number) => {
				// Enter/Space 的默认激活只在带 text 的 keyDown 上发生；缺 text 时 CDP 只送原始键事件，
				// 按钮的 click 不会触发，键盘用例会误报“没展开”。
				const text = name === "Enter" ? "\r" : name === " " ? " " : undefined;
				await page!.command("Input.dispatchKeyEvent", {
					type: "keyDown",
					key: name,
					code: name === " " ? "Space" : name,
					windowsVirtualKeyCode: code,
					...(text === undefined ? {} : { text }),
				});
				await page!.command("Input.dispatchKeyEvent", {
					type: "keyUp",
					key: name,
					code: name === " " ? "Space" : name,
					windowsVirtualKeyCode: code,
				});
			};
			for (const theme of ["light", "dark"]) {
				await page.command("Emulation.setEmulatedMedia", {
					features: [
						{ name: "prefers-color-scheme", value: theme },
						{ name: "prefers-reduced-motion", value: "reduce" },
					],
				});
				await page.wait(`document.documentElement.dataset.theme === '${theme}'`);
				await shot(`panel-bot-${theme}-collapsed-reduced.png`);
				await page.evaluate(`document.querySelector('[data-task="${task.id}"]').focus()`);
				await key("Enter", 13);
				expect(
					await page.evaluate(`document.querySelector('[data-task="${task.id}"]').getAttribute('aria-expanded')`),
				).toBe("true");
				expect(await page.evaluate('document.querySelector("#board-content").textContent')).toContain("请检查测试文档");
				expect(await page.evaluate('document.querySelector("#board-content").textContent')).not.toContain(
					"PRIVATE-LONG-ACCEPTANCE",
				);
				await shot(`panel-bot-${theme}-expanded-reduced.png`);
				await key(" ", 32);
				expect(
					await page.evaluate(`document.querySelector('[data-task="${task.id}"]').getAttribute('aria-expanded')`),
				).toBe("false");
			}
			await page.evaluate('document.querySelector("[data-focus-key=matter]").focus()');
			await key("Enter", 13);
			expect(await page.evaluate("document.activeElement.dataset.focusKey")).toBe("matter");
			await assertOnce();
			expect(
				await page.evaluate(
					`document.querySelector('[data-panel-group="${parent.id}"]').closest('details[data-group=done]')`,
				),
			).toBeNull();
			expect(
				await page.evaluate(
					'[...document.querySelector("#board-content").children].filter(n=>n.matches("section,details")).at(-1).dataset.group',
				),
			).toBe("done");
			await shot("panel-matter-dark-ended-collapsed.png");
			await key("Tab", 9);
			expect(await page.evaluate('document.activeElement.matches("[data-task],summary")')).toBe(true);
			await page.evaluate(
				`document.querySelector('[data-task="${task.id}"]').click();document.querySelector('[data-task="${child.id}"]').click()`,
			);
			expect(await page.evaluate('document.querySelectorAll("[data-task][aria-expanded=true]").length')).toBe(1);
			expect(
				await page.evaluate(`document.querySelector('[data-task="${task.id}"]').getAttribute('aria-expanded')`),
			).toBe("false");
			await page.command("Emulation.setDeviceMetricsOverride", {
				width: 320,
				height: 740,
				deviceScaleFactor: 1,
				mobile: false,
			});
			expect(
				await page.evaluate(
					'document.querySelector(".panel-scroll").scrollWidth <= document.querySelector(".panel-scroll").clientWidth',
				),
			).toBe(true);
			await shot("panel-matter-320-dark-reduced.png");
			await page.command("Emulation.setDeviceMetricsOverride", {
				width: 390,
				height: 760,
				deviceScaleFactor: 1,
				mobile: false,
			});
			// Real image error event, not a hand-drawn replacement.
			await page.evaluate('document.querySelector("[data-focus-key=bot]").click()');
			if (avatarUrl) {
				await page.evaluate('document.querySelector(".bot-avatar img").src="http://127.0.0.1:1/missing-test-image"');
				await page.wait('document.querySelector(".bot-avatar").getAttribute("aria-label").includes("加载失败")');
				await shot("panel-avatar-load-fallback.png");
			}
			f.store.update(task.id, { state: "active", note: "测试进展更新，可由真实轮询读取。" }, f.ctx);
			await page.evaluate(`document.querySelector('[data-task="${task.id}"]').click()`);
			await page.wait('document.querySelector("#board-content").textContent.includes("测试进展更新")');
			await assertOnce();
			// Bad source cannot retain old content or fall back to another caller.
			const renderer = JSON.parse(
				await (await import("node:fs/promises")).readFile(
					join(f.probe.api.paths.data, "../interaction/renderer.json"),
					"utf8",
				),
			);
			const bad = new URL("/bad-token", new URL(url).origin).href;
			expect(
				(
					await fetch(`${renderer.url}board`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ source: bad }),
					})
				).status,
			).toBe(200);
			await page.wait('document.querySelector("#board-content").textContent.includes("暂不可用")');
			expect(await page.evaluate('document.querySelectorAll("[data-task]").length')).toBe(0);
			await f.call("show", { target: "web" }, { ...f.ctx, agent: "foreign", capabilities: ["read"] });
			await page.wait('document.querySelectorAll("[data-task]").length === 1');
			expect(await page.evaluate('document.querySelector("#board-content").textContent')).not.toContain(
				"测试 · 核对小弹窗任务板",
			);
			if (output)
				await writeFile(
					join(output, "panel-browser-check.json"),
					JSON.stringify(
						{
							fixture: "测试预览、未装机",
							realStore: true,
							realCaller: true,
							realChrome: true,
							tasks: 8,
							groupModes: ["bot", "matter"],
							realAvatarLoaded: Boolean(avatarUrl),
							fallbackTested: Boolean(avatarUrl),
							screenshots,
							privacy: "bad token clears; foreign caller sees own only; no hidden parent info",
							keyboard: ["Enter", "Space", "Tab"],
						},
						null,
						2,
					),
				);
		} finally {
			await page?.close();
			await f.close();
		}
	},
	60000,
);
