import type { RunResult, SessionInfo } from "@yonder/sdk";

/**
 * 一次运行结束后该以什么原因关闭会话（返回 `undefined` 表示不关）。
 *
 * ephemeral 会话不承载后续输入，一次运行后总是关闭；task 会话只在这次运行**成功**时按 run-end 关闭——
 * 失败的运行必须还能继续，后台回报也要落回同一会话，否则主人会看到「Not an open task session」
 * 这种把技术细节当结果回灌的错误（见 docs/spec/10-runtime-guarantees.md 的运行保证）。
 */
export function closeOnRunEnd(
	mode: SessionInfo["mode"],
	status: RunResult["status"],
	close?: "run-end" | "manual",
): string | undefined {
	if (mode === "ephemeral") return status === "done" ? "completed" : status;
	if (mode === "task" && status === "done" && close !== "manual") return "completed";
	return undefined;
}
