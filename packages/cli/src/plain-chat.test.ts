import { PassThrough } from "node:stream";
import { observeControl, requestControl } from "@yonder/core";
import { beforeEach, expect, test, vi } from "vitest";
import { plainTaskChat } from "./plain-chat.js";

vi.mock("@yonder/core", async (original) => ({
	...(await original<typeof import("@yonder/core")>()),
	observeControl: vi.fn(),
	requestControl: vi.fn(),
}));

type Emit = (packet: unknown) => void;
let emit: Emit;
let onSubmit: (event: string) => void;

function sink() {
	const stream = new PassThrough();
	let text = "";
	stream.on("data", (chunk) => {
		text += String(chunk);
	});
	return { stream, text: () => text };
}

beforeEach(() => {
	vi.resetAllMocks();
	onSubmit = () => {};
	vi.mocked(observeControl).mockImplementation(async (_home, _request, listener) => {
		emit = listener as Emit;
		return { close: () => {} } as Awaited<ReturnType<typeof observeControl>>;
	});
	let n = 0;
	vi.mocked(requestControl).mockImplementation(async (_home, request) => {
		if (request.method === "sessions.open") return { id: "s1" };
		const event = `e${++n}`;
		queueMicrotask(() => onSubmit(event));
		return { event };
	});
});

function run(text: string, turnTimeoutMs = 60_000) {
	const input = new PassThrough();
	const out = sink(),
		err = sink();
	const done = plainTaskChat("/home", {} as never, false, {
		input,
		out: out.stream,
		err: err.stream,
		turnTimeoutMs,
	});
	input.end(text);
	return { done, out, err };
}

const assistant = (text: string) => ({
	type: "update",
	update: { type: "message", id: "m1", message: { role: "assistant", content: [{ type: "text", text }] } },
});
const ended = (event: string, status = "done", reason?: string) => ({
	type: "update",
	update: { type: "end", event: { data: { inputs: [event], status, ...(reason ? { reason } : {}) } } },
});

test("EOF 后收到 end 即正常返回回复", async () => {
	onSubmit = (event) => {
		emit(assistant("OK"));
		emit(ended(event));
	};
	const { done, out } = run("hi\n");
	await expect(done).resolves.toBeUndefined();
	expect(out.text()).toContain("OK");
});

test("模型失败只发 task_failed 与 run_end、没有 run.end 时不挂起，报错非 0", async () => {
	onSubmit = (event) => {
		emit({ type: "update", update: { type: "state", running: true, inputs: [event] } });
		emit({ type: "update", update: { type: "error", error: "no usable model: workbuddy held" } });
		emit({ type: "update", update: { type: "state", running: false, inputs: [event] } });
	};
	const { done, err } = run("hi\n");
	await expect(done).rejects.toThrow("no usable model");
	expect(err.text()).toContain("no usable model");
});

test("run.end 状态非 done 时以错误结束", async () => {
	onSubmit = (event) => emit(ended(event, "error", "upstream 503"));
	const { done, err } = run("hi\n");
	await expect(done).rejects.toThrow("upstream 503");
	expect(err.text()).toContain("error: upstream 503");
});

test("一直没有任何进展时按单轮超时退出", async () => {
	const { done } = run("hi\n", 50);
	await expect(done).rejects.toThrow("回复超时");
});

test("空输入直接返回，不打开会话", async () => {
	const { done } = run("");
	await expect(done).resolves.toBeUndefined();
	expect(requestControl).not.toHaveBeenCalled();
});
