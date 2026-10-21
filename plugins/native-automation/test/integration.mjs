import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../dist/index.js";

const data = await mkdtemp(join(tmpdir(), "yonder-native-check-"));
const tools = new Map(),
	triggers = [],
	handlers = new Map();
const api = {
	version: "1",
	paths: { data },
	tools: { register: (t) => tools.set(t.name, t) },
	triggers: { register: (t) => triggers.push(t) },
	events: { on: (name, handler) => handlers.set(name, handler) },
};
const ctx = {
	session: "session:1",
	env: { id: "node:local" },
	capabilities: ["read", "write", "exec", "network", "message"],
	signal: new AbortController().signal,
};
async function call(name, args, context = ctx) {
	const reply = await tools.get(name).execute(args, context);
	assert.equal(reply.isError, undefined, reply.text);
	return reply;
}
let received;
const server = createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	res.setHeader("content-type", "text/html; charset=utf-8");
	if (url.pathname === "/submit") {
		received = url.searchParams.get("note");
		res.end(
			`<title>Submitted</title><main><h1>Submission received</h1><p id="result"></p></main><script>document.querySelector('#result').textContent=${JSON.stringify(received)}</script>`,
		);
	} else
		res.end(
			'<title>Local form</title><main><h1>Local browser verification</h1><form action="/submit"><label>Note<input name="note" id="note"></label><button type="submit">Submit</button></form></main>',
		);
});
try {
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const url = `http://127.0.0.1:${server.address().port}/`;
	await plugin.setup(api);
	const status = JSON.parse((await call("native-automation_browser", { action: "status" })).text);
	assert.ok(status.executable);
	assert.equal(status.ownedSession, false);
	await call("native-automation_browser", { action: "navigate", url });
	const snapshot = JSON.parse((await call("native-automation_browser", { action: "snapshot" })).text);
	assert.ok(snapshot.result.snapshot.includes('textbox "Note"'));
	const value = `Yonder 本地真实浏览器闭环 ${new Date().toISOString()}`;
	await call("native-automation_browser", { action: "fill", selector: "#note", text: value });
	await call("native-automation_browser", { action: "click", selector: "button[type=submit]" });
	const actual = JSON.parse(
		(
			await call("native-automation_browser", {
				action: "evaluate",
				expression: 'document.querySelector("#result").textContent',
			})
		).text,
	);
	assert.equal(actual.result, value);
	assert.equal(received, value);
	const screenshot = await call("native-automation_browser", { action: "screenshot" });
	assert.equal(screenshot.images[0].mime, "image/png");
	const imagePath = JSON.parse(screenshot.text).path;
	assert.deepEqual((await readFile(imagePath)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const other = { ...ctx, session: "session:2" };
	assert.equal(
		JSON.parse((await call("native-automation_browser", { action: "status" }, other)).text).ownedSession,
		false,
	);
	const otherTabs = JSON.parse((await call("native-automation_browser", { action: "tabs" }, other)).text);
	assert.equal(otherTabs.result[0].url, "about:blank");
	const denied = await tools
		.get("native-automation_browser")
		.execute({ action: "evaluate", expression: "1" }, { ...ctx, capabilities: ["read"] });
	assert.equal(denied.isError, true);
	const cancel = new AbortController();
	const pending = tools
		.get("native-automation_browser")
		.execute(
			{ action: "evaluate", expression: 'new Promise(resolve=>setTimeout(()=>resolve("done"),60000))' },
			{ ...ctx, signal: cancel.signal },
		);
	setTimeout(() => cancel.abort(), 50);
	assert.equal((await pending).isError, true);
	assert.equal(JSON.parse((await call("native-automation_browser", { action: "status" })).text).ownedSession, false);
	await handlers.get("session.close")({ data: { session: other.session } });
	assert.equal((await tools.get("native-automation_browser").execute({ action: "tabs" }, other)).isError, true);
	await call("native-automation_browser", { action: "navigate", url }, { ...ctx, session: "session:3" });
	const permissions = JSON.parse((await call("native-automation_desktop", { action: "status" })).text).result;
	console.log(
		JSON.stringify({
			browser:
				"PASS: actual local HTTP navigation/ARIA snapshot/form fill/click/server receipt/evaluate/screenshot, session isolation, readonly refusal, cancellation and session cleanup",
			browserScreenshot: imagePath,
			desktopPermissions: permissions,
		}),
	);
	if (permissions.screenCapture) {
		const screenshot = await call("native-automation_desktop", { action: "screenshot" });
		assert.equal(screenshot.images[0].mime, "image/png");
		assert.ok(Buffer.from(screenshot.images[0].data, "base64").length > 100);
		console.log("PASS: background macOS screen observation; no mouse, keyboard or app activation performed");
	} else console.log("UNTESTED: desktop screenshot, screen recording permission unavailable");
} finally {
	for (const trigger of triggers) await trigger.stop();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	if (!process.env.YONDER_KEEP_ARTIFACTS) await rm(data, { recursive: true, force: true });
}
