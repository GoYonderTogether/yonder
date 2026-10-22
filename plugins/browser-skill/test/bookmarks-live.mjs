// Real built-plugin -> installed fork CLI -> isolated extension acceptance.
// Run only with a verified disposable browser instance and isolated BSK_HOME.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../dist/index.js";

assert(process.env.BSK_HOME && process.argv[2], "Requires isolated BSK_HOME and browser ID");
const directory = await mkdtemp(join(tmpdir(), "yonder-bsk-accept-"));
const tools = new Map();
let lifecycle;
plugin.setup({
	config: { bskPath: process.env.BSK_BOOKMARKS_BSK, bookmarksEnabled: true, extensionsEnabled: true },
	paths: { data: directory },
	tools: {
		register(t) {
			tools.set(t.name, t);
		},
	},
	skills: { register() {} },
	events: { on() {} },
	triggers: {
		register(t) {
			lifecycle = t;
		},
	},
	log: { warn: console.error },
});
const ctx = {
	agent: null,
	profile: "source-acceptance",
	session: "r2-b",
	env: { id: "node:local", cwd: directory },
	signal: new AbortController().signal,
};
async function call(group, args) {
	const result = await tools.get(`browser-skill_${group}`).execute(args, ctx);
	assert(!result.isError, result.text);
	return JSON.parse(result.text);
}
await lifecycle.start();
try {
	const { request } = await call("session", { action: "start", browser: process.argv[2] });
	const invoke = (action, args = {}) =>
		call("bookmarks", { action, session: request.session, ...args }).then((x) => x.result);
	const tree = await invoke("tree");
	const bar = tree.nodes[0].children.find(
		(n) => n.folderType === "bookmarks-bar" || n.title.toLowerCase() === "bookmarks bar",
	);
	assert(bar);
	const parent = (await invoke("create-folder", { parentId: bar.id, title: "R2 plugin acceptance" })).nodes[0];
	const child = (await invoke("create-folder", { parentId: bar.id, title: "R2 movable empty folder" })).nodes[0];
	const moved = (await invoke("move", { nodeId: child.id, parentId: parent.id })).nodes[0];
	assert.equal(moved.id, child.id);
	assert.equal(moved.parentId, parent.id);
	const rejected = await tools
		.get("browser-skill_bookmarks")
		.execute({ action: "remove-empty-folder", nodeId: parent.id, session: request.session }, ctx);
	assert(rejected.isError);
	assert.equal((await invoke("remove-empty-folder", { nodeId: child.id })).removed_id, child.id);
	assert.equal((await invoke("remove-empty-folder", { nodeId: parent.id })).removed_id, parent.id);
	const final = await invoke("tree");
	assert.deepEqual(
		final.nodes[0].children.map((n) => n.id),
		tree.nodes[0].children.map((n) => n.id),
	);
	const list = await call("extensions", { action: "list", session: request.session });
	assert(Array.isArray(list.result.extensions));
	await call("session", { action: "stop", session: request.session });
	console.log(
		"YONDER_PLUGIN_BOOKMARKS_OK: tree/create-folder/move/remove-empty-folder; nonempty refused; extensions list",
	);
} finally {
	await lifecycle.stop();
	await rm(directory, { recursive: true, force: true });
}
