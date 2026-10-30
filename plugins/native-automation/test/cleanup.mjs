import assert from "node:assert/strict";
import { once } from "node:events";
import { children, native } from "../dist/desktop.js";
import plugin from "../dist/index.js";

const handlers = new Map(),
	triggers = [];
await plugin.setup({
	paths: { data: "/tmp" },
	// Setup-only fixture; permission operations are not invoked by this script.
	permissions: { register() {} },
	tools: { register() {} },
	events: { on: (type, handler) => handlers.set(type, handler) },
	triggers: { register: (t) => triggers.push(t) },
});
async function start(owner, ignoreTerm) {
	const done = native(
		process.execPath,
		[
			"-e",
			`${ignoreTerm ? 'process.on("SIGTERM",()=>{});' : ""}setInterval(()=>{},1000);process.stdout.write("ready");`,
		],
		new AbortController().signal,
		owner,
	).catch((error) => error);
	const child = [...children.keys()].at(-1);
	await once(child.stdout, "data");
	return { child, done };
}
const first = await start("session:cleanup-1", false),
	second = await start("session:cleanup-2", true);
await handlers.get("session.close")({ data: { session: "session:cleanup-1" } });
assert.equal(children.has(first.child), false);
assert.throws(() => process.kill(first.child.pid, 0), { code: "ESRCH" });
assert.equal(children.has(second.child), true);
process.kill(second.child.pid, 0);
await triggers[0].stop();
assert.equal(children.size, 0);
assert.throws(() => process.kill(second.child.pid, 0), { code: "ESRCH" });
assert.equal(second.child.signalCode, process.platform === "win32" ? "SIGTERM" : "SIGKILL");
await Promise.all([first.done, second.done]);
console.log(
	"PASS: session.close waits for its real child close and preserves another session; stop waits for SIGTERM-resistant child SIGKILL+close; children map empty, both PIDs gone",
);
