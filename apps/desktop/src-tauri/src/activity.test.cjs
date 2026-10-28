const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

test("activity subscription marks the tray offline when the stream ends", () => {
	const calls = [];
	let socket;
	class WebSocket {
		constructor() { socket = this; }
		close() { this.onclose(); }
	}
	runInNewContext(readFileSync(`${__dirname}/activity.js`, "utf8"), {
		location: { hostname: "127.0.0.1", pathname: "/console/", href: "http://127.0.0.1/console/" },
		URL, WebSocket, window: { __TAURI_INTERNALS__: { invoke: (...args) => calls.push(args) } },
		clearInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
	});
	socket.onmessage({ data: JSON.stringify({ sub: "desktop-activity", t: "ready", result: { running: 1, waiting: 2 } }) });
	socket.onmessage({ data: JSON.stringify({ sub: "desktop-activity", t: "end" }) });
	assert.deepEqual(calls.map(([name]) => name), ["set_activity", "set_offline"]);
});
