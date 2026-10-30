import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "../src/api/http";
import { verifyErrorText } from "../src/lib/verify";

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify(body), { status, headers })),
	);
}

describe("登录接口错误", () => {
	it("错误验证码的 401 不触发登出事件，页面留在登录面板", async () => {
		const unauthorized = vi.fn();
		vi.stubGlobal("window", { dispatchEvent: unauthorized });
		respond(401, { error: "invalid_code" });
		const error = await httpApi.verifyCode({ kind: "email", target: "a@b.test", code: "000000" }).catch((e) => e);
		expect(unauthorized).not.toHaveBeenCalled();
		expect(verifyErrorText(error)).toBe("验证码不正确，请重新输入");
	});

	it("普通接口的 401 仍触发登出事件", async () => {
		const unauthorized = vi.fn();
		vi.stubGlobal("window", { dispatchEvent: unauthorized });
		respond(401, { error: "unauthorized" });
		await httpApi.session().catch(() => {});
		expect(unauthorized).toHaveBeenCalledTimes(1);
	});

	it("发码冷却 429 显示还需等待的秒数（来自 Retry-After）", async () => {
		respond(429, { error: "rate_limited" }, { "Retry-After": "37" });
		const error = await httpApi.sendCode({ kind: "email", target: "a@b.test" }).catch((e) => e);
		expect(verifyErrorText(error)).toBe("操作太频繁，请 37 秒后再试");
		expect(verifyErrorText({ code: "rate_limited" })).toBe("操作太频繁，请稍后再试");
	});
});
