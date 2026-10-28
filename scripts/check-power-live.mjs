import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const disabled = () => /SleepDisabled\s+1/.test(execFileSync("/usr/bin/pmset", ["-g"], { encoding: "utf8" }));
const connect = () =>
	new Promise((resolve, reject) => {
		const s = createConnection("/var/run/dev.yonder.power.sock");
		s.once("error", reject);
		s.once("connect", () => resolve(s));
	});
const send = (s, count) =>
	new Promise((resolve, reject) => {
		s.once("data", (data) => {
			try {
				resolve(JSON.parse(data.toString()));
			} catch (e) {
				reject(e);
			}
		});
		s.write(JSON.stringify({ active: count }) + "\n");
	});
const a = await connect(),
	b = await connect();
try {
	assert.equal(disabled(), false);
	let state = await send(a, 2);
	assert.equal(state.protected, true);
	assert.equal(disabled(), true);
	state = await send(b, 1);
	assert.equal(state.active, 3);
	await send(a, 0);
	assert.equal(disabled(), true);
	b.destroy();
	await delay(500);
	assert.equal(disabled(), false);
	await send(a, 1);
	assert.equal(disabled(), true);
	await delay(6200);
	assert.equal(disabled(), false);
	console.log("PASS: real pmset enable, 2 owners, last-owner disconnect restore, expired lease restore");
} finally {
	a.destroy();
	b.destroy();
}
