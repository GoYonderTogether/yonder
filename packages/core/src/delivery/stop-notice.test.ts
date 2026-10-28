import { expect, test } from "vitest";
import { stopNotice } from "./index.js";

test("a network stop is explained plainly without the provider error", () => {
	const notice = stopNotice(
		"model_error: Model fallback chain exhausted (3 consecutive failures per model): Connection error.",
	);
	expect(notice).toBe("网络连接中断，这一轮没有完成。网络恢复后回我一句，我接着做。");
	expect(stopNotice("fetch failed; cause: ECONNRESET")).toBe(notice);
});

test("other stops never echo the raw reason", () => {
	expect(stopNotice("repeatStop")).toBe(
		"运行已停止，这一轮没有完成。回我一句我可以重新开始；反复出现请管理员查看日志。",
	);
	expect(stopNotice("x".repeat(400))).not.toContain("xxx");
});

test("an exhausted model chain gives a category and an action, not the provider text", () => {
	const chain = (cause: string) =>
		`model_error: Model fallback chain exhausted (3 consecutive failures per model): ${cause}`;
	expect(stopNotice(chain("429 Too Many Requests"))).toContain("额度");
	expect(stopNotice(chain("401 invalid api key sk-secret-123"))).toBe(
		"模型账号验证失败，这一轮没有完成。请管理员检查模型凭据后再回我一句。",
	);
	expect(stopNotice(chain("503 upstream https://internal.example/v1 overloaded"))).toContain("暂时不可用");
	expect(stopNotice(chain("Request timed out: no first token within 20000ms"))).toContain("超时");
	const other = stopNotice(chain("weird provider body <html>boom</html>"));
	expect(other).toContain("模型都不可用（model_error）");
	expect(other).not.toContain("boom");
	expect(stopNotice("no_model")).toContain("模型都不可用（model_error）");
});
