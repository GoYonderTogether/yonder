// Actual brand SVG renderer sampled at equal wall-time intervals. Test preview, not a product UI.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { browser } from "../../plugins/ui-companion/test/browser.ts";

const output = process.env.YONDER_UI_PREVIEW;
if (!output) throw new Error("Set YONDER_UI_PREVIEW to an evidence directory");
const source = (await readFile(new URL("./yonder-mark.js", import.meta.url), "utf8")).replace(/^export /gm, "");
const page = await browser();
try {
	await page.command("Emulation.setDeviceMetricsOverride", {
		width: 1100,
		height: 320,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.evaluate(
		`document.body.innerHTML='<h3>品牌动画真实渲染测试预览 · 候选、未装机</h3><p>60 Hz 时间采样，速度 1/3；每格间隔 3 秒（非示意图）</p><svg id="source" style="display:none"></svg><div id="samples" style="display:flex"></div>';document.body.style.cssText='font:14px system-ui;padding:12px'; window.requestAnimationFrame=(f)=>{window.nextFrame=f;window.frameCount=(window.frameCount||0)+1;return window.frameCount};window.cancelAnimationFrame=()=>{};Math.random=()=>0.5;`,
	);
	await page.evaluate(
		`${source}\nwindow.character=createCharacter(document.querySelector('#source'),{state:'work',pointer:false});`,
	);
	const evidence =
		await page.evaluate(`(()=>{const times=[];for(let i=0;i<=900;i++){const ms=i*1000/60;window.nextFrame(ms);if(i%180===0){const clone=document.querySelector('#source').cloneNode(true);clone.removeAttribute('id');clone.style.cssText='width:168px;height:168px';// Isolate mask IDs so each sample retains its own geometry.
const suffix='sample'+i;const prefix=clone.querySelector('mask').id.slice(0,-1);clone.innerHTML=clone.innerHTML.replaceAll(prefix,suffix);const cell=document.createElement('div');cell.style.textAlign='center';cell.append(clone,document.createTextNode((ms/1000)+' s'));document.querySelector('#samples').append(cell);times.push({wallSeconds:ms/1000,timelineSeconds:motionSeconds(ms)});}}window.character.destroy();return {times,frames:window.frameCount,scale:MOTION_TIME_SCALE}})()`);
	assert.equal(evidence.frames, 902);
	assert.deepEqual(
		evidence.times.map((item) => item.timelineSeconds),
		[0, 1, 2, 3, 4, 5],
	);
	const image = await page.command("Page.captureScreenshot", { format: "png" });
	await writeFile(resolve(output, "logo-time-samples.png"), Buffer.from(image.data, "base64"));
	await writeFile(resolve(output, "logo-time-samples.json"), JSON.stringify(evidence, null, 2));
	console.log(
		"Passed: actual SVG 60Hz renderer, 902 frame requests, wall 0/3/6/9/12/15s → original timeline 0/1/2/3/4/5s.",
	);
} finally {
	await page.close();
}
