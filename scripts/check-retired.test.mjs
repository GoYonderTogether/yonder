import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import {
	missingInteractionViews,
	missingSwiftCompanion,
	missingTasksViews,
	missingWebBuild,
	parseArgs,
	streamReady,
	TARGETS,
} from "./check-retired.mjs";

const view = (overrides) => ({
	id: "x.one",
	plugin: "x",
	title: "x",
	placement: "rail",
	scope: "node",
	...overrides,
});

/** 只复现 /api/stream 的帧形状与握手，不模拟任何模型或数据。 */
async function stubStream(onSubscribe) {
	const server = createServer((_request, response) => response.end());
	const sockets = new WebSocketServer({ server });
	sockets.on("connection", (socket) => socket.on("message", (raw) => onSubscribe(JSON.parse(String(raw)), socket)));
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return {
		base: `http://127.0.0.1:${server.address().port}`,
		async close() {
			for (const client of sockets.clients) client.terminate();
			await new Promise((done) => sockets.close(done));
			await new Promise((done) => server.close(done));
		},
	};
}

test("parseArgs 只接受四个目标并给出用法", () => {
	assert.deepEqual(parseArgs(["--target", "tasks-http"]), { target: "tasks-http" });
	for (const target of TARGETS) assert.deepEqual(parseArgs(["--target", target]), { target });
	assert.match(parseArgs([]).error, /--target/);
	assert.match(parseArgs(["--target", "interaction"]).error, /interaction-http\|tasks-http/);
	assert.equal(spawnSync(process.execPath, [join(import.meta.dirname, "check-retired.mjs")]).status, 2);
});

test("interaction 门禁要求 floating 的 interaction 视图", () => {
	assert.deepEqual(missingInteractionViews([]), ["views.list 缺少 interaction 的 floating 提问卡视图"]);
	assert.deepEqual(
		missingInteractionViews([view({ id: "interaction.card", plugin: "interaction", placement: "page" })]).length,
		1,
	);
	assert.deepEqual(
		missingInteractionViews([
			view({ id: "interaction.card", plugin: "interaction", placement: "floating", scope: "session" }),
		]),
		[],
	);
});

test("tasks 门禁要求看板/digest 视图", () => {
	assert.equal(missingTasksViews([view({ plugin: "tasks", id: "tasks.rail" })]).length, 1);
	assert.deepEqual(missingTasksViews([view({ plugin: "tasks", id: "tasks.board" })]), []);
	assert.deepEqual(missingTasksViews([view({ plugin: "tasks", title: "任务看板" })]), []);
	assert.deepEqual(missingTasksViews([view({ plugin: "interaction", id: "tasks.board" })]).length, 1);
});

test("Swift 门禁要求 WKWebView 与 shell=desktop 都在 packages/macos 源码里", () => {
	assert.deepEqual(missingSwiftCompanion(["import WebKit\nlet web = WKWebView(frame: .zero)"]), [
		"packages/macos 没有 /console/?shell=desktop 入口",
	]);
	assert.deepEqual(missingSwiftCompanion(['url = "/console/?shell=desktop"']), [
		"packages/macos 没有 WKWebView 加载实现",
	]);
	assert.deepEqual(missingSwiftCompanion(["let web = WKWebView()", 'base + "/console/?shell=desktop"']), []);
});

test("前端门禁要求 apps/app 构建产物", () => {
	assert.deepEqual(missingWebBuild(true), []);
	assert.deepEqual(missingWebBuild(false), ["apps/app 缺少构建产物 apps/app/dist/index.html"]);
});

test("streamReady 返回 ready 帧的 result", async () => {
	const stub = await stubStream((frame, socket) => {
		assert.deepEqual(frame, { t: "sub", sub: "gate", method: "activity.watch", params: {} });
		socket.send(JSON.stringify({ t: "ready", sub: "gate", result: { running: 0, sessions: [] } }));
	});
	try {
		assert.deepEqual(await streamReady(stub.base, "session=1", "activity.watch"), {
			running: 0,
			sessions: [],
		});
	} finally {
		await stub.close();
	}
});

test("streamReady 在 end 帧与超时时失败", async () => {
	const ending = await stubStream((_frame, socket) =>
		socket.send(JSON.stringify({ t: "end", sub: "gate", reason: "error", error: { code: "unknown_method" } })),
	);
	try {
		await assert.rejects(streamReady(ending.base, "session=1", "activity.watch"), /unknown_method/);
	} finally {
		await ending.close();
	}
	const silent = await stubStream(() => {});
	try {
		await assert.rejects(streamReady(silent.base, "session=1", "activity.watch", {}, 200), /没有 ready 帧/);
	} finally {
		await silent.close();
	}
});
