import { expect, test } from "vitest";
import { stopNotice } from "./index.js";

test("a network stop is explained plainly without the provider error", () => {
	const notice = stopNotice(
		"model_error: Model fallback chain exhausted (3 consecutive failures per model): Connection error.",
	);
	expect(notice).toBe("网络连接中断，这一轮没有完成。网络恢复后回我一句，我接着做。");
	expect(stopNotice("fetch failed; cause: ECONNRESET")).toBe(notice);
});

test("other stops keep a short reason", () => {
	expect(stopNotice("repeatStop")).toBe("运行已停止：repeatStop。");
	expect(stopNotice("x".repeat(400))).toHaveLength("运行已停止：".length + 161 + 1);
});

test("an exhausted model chain tells the person the round did not finish", () => {
	expect(
		stopNotice("model_error: Model fallback chain exhausted (3 consecutive failures per model): 429 Too Many Requests"),
	).toBe("模型都不可用（model_error），这一轮没有完成。原因：429 Too Many Requests");
	expect(stopNotice("no_model")).toBe("模型都不可用（model_error），这一轮没有完成。过一会儿回我一句，我重试。");
});
