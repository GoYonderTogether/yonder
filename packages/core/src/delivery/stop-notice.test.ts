import { expect, test } from "vitest";
import { stopNotice } from "./index.js";

/** 系统提示的固定结构：一行标记与结论、可选一行详情、一行处理。 */
const shape = (notice: string) => notice.split("\n");

test("a network stop is explained plainly, marked as a system notice, without the provider error", () => {
	const notice = stopNotice(
		"model_error: Model fallback chain exhausted (3 consecutive failures per model): Connection error.",
	);
	const [first, detail, action] = shape(notice);
	expect(first).toBe("【系统】网络连接中断，这一轮没有完成。");
	expect(detail).toBe("详情：Connection error.");
	expect(action).toBe("处理：网络恢复后回我一句，我接着做。");
	expect(stopNotice("fetch failed; cause: ECONNRESET").startsWith("【系统】")).toBe(true);
});

test("other stops are marked as system notices and never echo the raw reason", () => {
	const [first, , action] = shape(stopNotice("repeatStop"));
	expect(first).toBe("【系统】运行已停止，这一轮没有完成。");
	expect(action).toBe("处理：回我一句我可以重新开始；反复出现请管理员查看日志。");
	const long = stopNotice(`repeatStop ${"x".repeat(400)}`);
	expect(long).not.toContain("x".repeat(60));
});

test("an exhausted model chain gives a category, an action and a truncated cause", () => {
	const chain = (cause: string) =>
		`model_error: Model fallback chain exhausted (3 consecutive failures per model): ${cause}`;
	expect(stopNotice(chain("429 Too Many Requests"))).toContain("额度");
	expect(shape(stopNotice(chain("401 invalid api key sk-secret-123")))).toEqual([
		"【系统】模型账号验证失败，这一轮没有完成。",
		"详情：401 invalid api key [密钥]",
		"处理：请管理员检查模型凭据后再回我一句。",
	]);
	expect(stopNotice(chain("503 upstream https://internal.example/v1 overloaded"))).toContain("暂时不可用");
	expect(stopNotice(chain("Request timed out: no first token within 20000ms"))).toContain("超时");
	const tooLarge = stopNotice(
		chain('413: {"message":"payload too large (20602435 bytes > 16777216 limit)","type":"invalid_request_error"}'),
	);
	expect(tooLarge).toContain("超出了上限");
	expect(tooLarge).toContain("payload too large");
	const other = stopNotice(chain("weird provider body <html>boom</html>"));
	expect(other).toContain("【系统】模型链没有跑通");
	expect(other).toContain("boom");
	expect(stopNotice("no_model")).toContain("【系统】模型链没有跑通");
});

test("the detail line is capped and never carries credentials or internal addresses", () => {
	const long = stopNotice(`model_error: ${"failed to reach upstream. ".repeat(20)}`);
	const detail = shape(long).find((line) => line.startsWith("详情："))!;
	expect(detail.length).toBeLessThanOrEqual("详情：".length + 161);
	expect(detail.endsWith("…")).toBe(true);
	expect(stopNotice("model_error: 401 Bearer abcdef123456 rejected")).not.toContain("abcdef123456");
	expect(stopNotice("model_error: 401 api_key=supersecretvalue1 rejected")).not.toContain("supersecretvalue1");
	expect(stopNotice("model_error: 401 access_token: abcdef1234567890")).not.toContain("abcdef1234567890");
	// 键名后面跟普通单词时原样保留，否则详情读不通。
	expect(stopNotice("model_error: OpenAI OAuth token request failed (400)")).toContain("token request failed");
	expect(stopNotice("model_error: 503 https://internal.example/v1/chat/secret-path")).not.toContain("secret-path");
	// 没有可读原因时不留一行空的详情。
	expect(shape(stopNotice("model_error"))).toHaveLength(2);
});

test("categories stay in priority order for the failures this host actually produced", () => {
	// 额度池耗尽的文案里同时出现 “daily token limit”，不能因此被当成请求过大。
	const pool = stopNotice(
		'model_error: 503: {"message":"no usable account for realm \'intl\': all are disabled, cooling down, expired or parked by the daily token limit","code":503}',
	);
	expect(pool).toContain("额度");
	expect(pool).not.toContain("超出了上限");
	// 413 的正文里同时有 payload 和 16MB，要判成请求过大而不是服务不可用。
	const tooLarge = stopNotice(
		'model_error: 413: {"message":"payload too large (20602435 bytes > 16777216 limit)","type":"invalid_request_error","code":413}',
	);
	expect(tooLarge).toContain("超出了上限");
	// OAuth 刷新被拒：鉴权，不是网络。
	expect(stopNotice('model_error: OAuth refresh failed for openai: (400): {"error": "invalid_grant"}')).toContain(
		"模型账号验证失败",
	);
});
