// Explicit synthetic UI fixture preview. Uses the project's existing isolated CDP browser.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { browser } from "./browser.ts";

const cases = JSON.parse(await readFile(new URL("../../../packages/macos/test/activity-cases.json", import.meta.url)));
const html = await readFile(new URL("../dist/index.html", import.meta.url));
let networkSummary = { schemaVersion: 1, sourceRevision: 5, availability: "unpublished" };
const summaryRequests = [];
const server = createServer((request, response) => {
	if (request.url === "/preview/activity-summary") {
		summaryRequests.push(request.url);
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify(networkSummary));
	} else if (request.url === "/preview/state") {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ active: null, history: [] }));
	} else {
		response.writeHead(200, { "Content-Type": "text/html" });
		response.end(html);
	}
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let page;
try {
	page = await browser();
	await page.command("Emulation.setDeviceMetricsOverride", {
		width: 900,
		height: 920,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.command("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
	await page.wait("Boolean(window.yonderUI)");
	await page.evaluate(
		`window.yonderUI.setSurface('window'); document.querySelector('.preview-bar').innerHTML='<strong>Companion 测试预览 · 候选、未装机 · 合成 fixture，非真实运行数据</strong>'; document.querySelector('#panel').hidden=false; document.querySelector('#panel').style.cssText='position:relative;left:auto;top:auto;width:560px;height:820px;max-height:none;margin:20px auto';`,
	);
	for (const item of cases) {
		await page.evaluate(
			`window.yonderUI.activity(${JSON.stringify({ agents: [item.agent], known: item.known, activitySummary: item.summary })})`,
		);
		const row = await page.evaluate(
			`(()=>{const row=document.querySelector('.agent-row');return {state:row.dataset.state, label:row.querySelector('.agent-status').textContent, weight:getComputedStyle(row.querySelector('strong')).fontWeight, name:row.getAttribute('aria-label')}})()`,
		);
		assert.equal(row.state, item.expected.state, item.name);
		assert.equal(row.label, item.expected.label, item.name);
		assert.equal(row.weight, item.expected.emphasized ? "700" : "500", item.name);
		assert.ok(row.name.includes(item.expected.label));
	}
	const selected = cases.slice(0, 8);
	const agents = selected.map((item, index) => ({ ...item.agent, id: `fixture-${index}`, tasks: [] }));
	// Keep execution phase facts while omitting verbose test task text from this visual overview.
	selected.forEach((item, index) => {
		agents[index].tasks = item.agent.tasks.map((task) => ({ execution: task.execution }));
	});
	const summary = {
		schemaVersion: 1,
		sourceRevision: 3,
		availability: "available",
		summary: {
			schemaVersion: 1,
			observedAt: 1,
			agents: selected.map((item, index) => ({ ...item.summary.summary.agents[0], agentId: agents[index].id })),
		},
	};
	const payload = { agents, known: true, pinned: true, activitySummary: summary };
	await page.evaluate(
		`window.yonderUI.activity(${JSON.stringify(payload)});document.querySelector('#board-button').hidden=false;document.querySelector('#pin-button').hidden=false;`,
	);
	const output = process.env.YONDER_UI_PREVIEW;
	if (output) await mkdir(output, { recursive: true });
	const evidence = [];
	for (const theme of ["light", "dark"]) {
		await page.command("Emulation.setEmulatedMedia", {
			features: [
				{ name: "prefers-color-scheme", value: theme },
				{ name: "prefers-reduced-motion", value: "reduce" },
			],
		});
		await page.wait(`document.documentElement.dataset.theme === '${theme}'`);
		const styles = await page.evaluate(
			`Array.from(document.querySelectorAll('.agent-row')).map(row=>({state:row.dataset.state,color:getComputedStyle(row.querySelector('.agent-status'),'::before').backgroundColor,animation:getComputedStyle(row.querySelector('.agent-status'),'::before').animationName}))`,
		);
		assert.ok(styles.every((row) => row.animation === "none"));
		const expected =
			theme === "light"
				? ["rgb(135, 97, 19)", "rgb(180, 52, 44)", "rgb(54, 94, 121)", "rgb(114, 113, 107)"]
				: ["rgb(230, 189, 100)", "rgb(234, 107, 95)", "rgb(168, 203, 230)", "rgb(166, 166, 161)"];
		for (const [index, state] of ["running", "blocked", "review", "idle"].entries())
			assert.equal(styles.find((row) => row.state === state).color, expected[index]);
		await page.evaluate("document.activeElement?.blur()");
		await page.command("Input.dispatchKeyEvent", {
			type: "keyDown",
			key: "Tab",
			code: "Tab",
			windowsVirtualKeyCode: 9,
		});
		await page.command("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
		const pin = await page.evaluate(
			`(()=>{const n=document.querySelector('#pin-button');n.focus();return {label:n.getAttribute('aria-label'),focused:document.activeElement===n,outline:getComputedStyle(n).outlineStyle,geometry:document.querySelector('#i-pin path').getAttribute('d')}})()`,
		);
		assert.equal(pin.label, "取消固定悬浮入口");
		assert.ok(pin.focused);
		assert.equal(pin.outline, "solid");
		assert.equal(pin.geometry, "M12 17v5");
		evidence.push({ theme, reduceMotion: true, styles, pin });
		if (output) {
			await page.evaluate(
				"Promise.all(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations !== Infinity).map(a=>a.finished.catch(()=>{})))",
			);
			const shot = await page.command("Page.captureScreenshot", { format: "png" });
			await writeFile(resolve(output, `companion-${theme}-reduced.png`), Buffer.from(shot.data, "base64"));
		}
	}
	// Returning from red/blue to zero counts must remove the main light, not retain a stale badge.
	await page.evaluate(
		`window.yonderUI.activity(${JSON.stringify({ agents: [{ id: "fixture-4", name: "状态清除", state: "idle", tasks: [] }], known: true, activitySummary: { ...summary, sourceRevision: 4, summary: { schemaVersion: 1, observedAt: 2, agents: [] } } })})`,
	);
	assert.equal(await page.evaluate("document.querySelector('.agent-row').dataset.state"), "idle");
	if (output)
		await writeFile(
			resolve(output, "companion-browser-check.json"),
			JSON.stringify({ sharedCases: cases.length, evidence }, null, 2),
		);
	// Exercise the actual connected-page GET seam against an explicitly synthetic loopback fixture.
	await page.command("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/preview/` });
	await page.wait("Boolean(window.yonderUI)");
	await page.evaluate(
		`window.yonderUI.activity(${JSON.stringify({ agents: [{ id: "network", name: "GET seam fixture", state: "idle", tasks: [] }], known: true })})`,
	);
	for (const [revision, counts, expectedState] of [
		[6, { blocked: 1, review: 2, waitingUser: 0 }, "blocked"],
		[7, { blocked: 0, review: 1, waitingUser: 0 }, "review"],
		[8, null, "idle"],
		[9, { blocked: 0, review: 0, waitingUser: 0 }, "idle"],
	]) {
		networkSummary = counts
			? {
					schemaVersion: 1,
					sourceRevision: revision,
					availability: "available",
					summary: { schemaVersion: 1, observedAt: revision, agents: [{ agentId: "network", ...counts }] },
				}
			: { schemaVersion: 1, sourceRevision: revision, availability: "unavailable" };
		await page.wait(
			`document.querySelector('.agent-row')?.dataset.state === '${expectedState}' ${revision === 8 ? "&& document.querySelector('.agent-counts').textContent === '事项状态暂不可用'" : revision === 9 ? "&& document.querySelector('.agent-counts').textContent === ''" : ""}`,
		);
	}
	assert.ok(summaryRequests.length >= 4);
	console.log(
		`Passed ${cases.length} rendered activity cases; dynamic light/dark tokens, bold, labels, official icon geometry, keyboard focus, Reduce Motion; actual GET activity-summary red→blue→unavailable→cleared fixture.`,
	);
} finally {
	await page?.close();
	await new Promise((done) => server.close(done));
}
