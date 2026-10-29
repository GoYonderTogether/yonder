import { describe, expect, it } from "vitest";
import {
	canSendCode,
	canVerifyCode,
	initialVerifyForm,
	maskEmail,
	maskPhone,
	maskTarget,
	needsVerify,
	normalizeEmail,
	normalizePhone,
	normalizeTarget,
	resendLabel,
	type VerifyFormState,
	validateCode,
	validateTarget,
	verifyErrorText,
	verifyReducer,
} from "../../src/features/social/lib/session";

/** 依次跑事件，返回最终状态；用来把状态机写成可读的路径。 */
function run(events: Parameters<typeof verifyReducer>[1][], from: VerifyFormState = initialVerifyForm) {
	return events.reduce(verifyReducer, from);
}

describe("verifyReducer", () => {
	it("walks idle → sending → countdown", () => {
		expect(initialVerifyForm).toMatchObject({ phase: "idle", seconds: 0, sent: false, error: "" });
		const sending = run([{ type: "send" }]);
		expect(sending).toMatchObject({ phase: "sending", sent: false });
		const sent = verifyReducer(sending, { type: "sent", retryAfter: 60 });
		expect(sent).toEqual({ phase: "countdown", seconds: 60, sent: true, error: "" });
	});

	it("falls back to 60 seconds when retryAfter is missing or invalid", () => {
		for (const retryAfter of [undefined, 0, -5, Number.NaN]) {
			expect(verifyReducer(initialVerifyForm, { type: "sent", retryAfter })).toMatchObject({ seconds: 60 });
		}
	});

	it("rounds a fractional retryAfter up", () => {
		expect(verifyReducer(initialVerifyForm, { type: "sent", retryAfter: 12.2 })).toMatchObject({ seconds: 13 });
	});

	it("counts down to zero and stops there", () => {
		let state = verifyReducer(initialVerifyForm, { type: "sent", retryAfter: 2 });
		state = run([{ type: "tick" }], state);
		expect(state.seconds).toBe(1);
		state = run([{ type: "tick" }], state);
		expect(state.seconds).toBe(0);
		state = run([{ type: "tick" }], state);
		expect(state.seconds).toBe(0);
	});

	it("walks countdown → verifying → error, keeping the countdown", () => {
		const sent = verifyReducer(initialVerifyForm, { type: "sent", retryAfter: 30 });
		const verifying = verifyReducer(sent, { type: "verify" });
		expect(verifying).toMatchObject({ phase: "verifying", error: "" });
		const failed = verifyReducer(verifying, { type: "verify_failed", error: { status: 401, code: "invalid_code" } });
		expect(failed).toMatchObject({ phase: "error", seconds: 30, sent: true });
		expect(failed.error).toBe("验证码不正确，请重新输入");
		// 错误后可以填新码重试，不用重新发送。
		expect(canVerifyCode(failed)).toBe(true);
		expect(canSendCode(failed)).toBe(false);
	});

	it("does not verify before a code was sent", () => {
		const failed = verifyReducer(initialVerifyForm, { type: "send_failed", error: { status: 502 } });
		expect(failed.phase).toBe("error");
		expect(canVerifyCode(failed)).toBe(false);
		expect(canSendCode(failed)).toBe(true);
	});

	it("ignores duplicate send/verify while a request is in flight", () => {
		const sending = verifyReducer(initialVerifyForm, { type: "send" });
		expect(verifyReducer(sending, { type: "send" })).toBe(sending);
		const verifying = verifyReducer(verifyReducer(sending, { type: "sent" }), { type: "verify" });
		expect(verifyReducer(verifying, { type: "verify" })).toBe(verifying);
	});

	it("resets back to idle when switching tabs", () => {
		const sent = verifyReducer(initialVerifyForm, { type: "sent", retryAfter: 60 });
		expect(verifyReducer(sent, { type: "reset" })).toEqual(initialVerifyForm);
	});
});

describe("verifyErrorText", () => {
	const cases: [unknown, string][] = [
		[{ status: 401, code: "invalid_code" }, "验证码不正确，请重新输入"],
		[{ status: 429, code: "locked" }, "尝试次数过多，请稍后再试"],
		[{ status: 403, code: "share_exhausted" }, "这个分享链接的名额已用完，请让分享者重新生成"],
		[{ status: 403, code: "share_expired" }, "这个分享链接已过期，请让分享者重新生成"],
		[{ status: 403, code: "share_revoked" }, "这个分享链接已被撤销，请让分享者重新生成"],
		[{ status: 429, code: "rate_limited" }, "操作太频繁，请稍后再试"],
		[{ status: 502, code: "send_failed" }, "验证码发送失败，请稍后重试"],
		[{ status: 409, code: "phone_taken" }, "这个手机号已绑定其他账号"],
		[{ status: 409, code: "email_taken" }, "这个邮箱已绑定其他账号"],
		[{ status: 429 }, "操作太频繁，请稍后再试"],
		[{ status: 502 }, "验证码发送失败，请稍后重试"],
		[{ status: 401 }, "验证码不正确，请重新输入"],
		[{ status: 403 }, "这个分享链接不可用，请让分享者重新生成"],
	];
	it.each(cases)("maps %j to a readable sentence", (error, text) => {
		expect(verifyErrorText(error)).toBe(text);
	});

	it("uses the raw code when unknown and the fallback when empty", () => {
		expect(verifyErrorText({ status: 500, code: "internal_error" })).toBe("internal_error");
		expect(verifyErrorText(undefined)).toBe("验证失败，请重试");
		expect(verifyErrorText(new Error("boom"))).toBe("boom");
		expect(verifyErrorText(new Error(""), "兜底")).toBe("兜底");
	});

	it("does not leak a share error as a generic failure", () => {
		for (const code of ["share_exhausted", "share_expired", "share_revoked"])
			expect(verifyErrorText({ status: 403, code })).toContain("分享链接");
	});
});

describe("needsVerify", () => {
	it("only true for the verify_required error code", () => {
		expect(needsVerify({ status: 403, code: "verify_required" })).toBe(true);
		expect(needsVerify({ status: 403, code: "share_expired" })).toBe(false);
		expect(needsVerify(new Error("verify_required"))).toBe(false);
		expect(needsVerify(undefined)).toBe(false);
	});
});

describe("target validation", () => {
	it("accepts 11-digit mainland phone numbers only", () => {
		expect(validateTarget("phone", "13800001234")).toBeUndefined();
		expect(validateTarget("phone", "19912345678")).toBeUndefined();
		for (const bad of ["12345678901", "12800001234", "1380000123", "138000012345", "abcdefghijk"])
			expect(validateTarget("phone", bad)).toBe("请输入 11 位手机号");
	});

	it("normalizes phone input before validating", () => {
		expect(validateTarget("phone", "138 0000 1234")).toBeUndefined();
		expect(validateTarget("phone", "+86 13800001234")).toBeUndefined();
		expect(normalizePhone("+86 138-0000-1234")).toBe("13800001234");
	});

	it("accepts ordinary emails and rejects malformed ones", () => {
		expect(validateTarget("email", "a@b.co")).toBeUndefined();
		expect(validateTarget("email", "Alice@Example.COM ")).toBeUndefined();
		for (const bad of ["a@b", "a b@c.com", "@c.com", "a@.com"])
			expect(validateTarget("email", bad)).toBe("邮箱格式不正确");
	});

	it("leaves empty values to the form's required state", () => {
		expect(validateTarget("phone", "")).toBeUndefined();
		expect(validateTarget("email", "   ")).toBeUndefined();
		expect(validateCode("")).toBeUndefined();
	});

	it("requires exactly six digits for the code", () => {
		expect(validateCode("123456")).toBeUndefined();
		for (const bad of ["12345", "1234567", "12345a"]) expect(validateCode(bad)).toBe("请输入 6 位数字验证码");
	});

	it("normalizes by kind", () => {
		expect(normalizeTarget("phone", "+86 138 0000 1234")).toBe("13800001234");
		expect(normalizeTarget("email", " A@B.CO ")).toBe("a@b.co");
		expect(normalizeEmail(" Alice@Example.COM ")).toBe("alice@example.com");
	});
});

describe("masking", () => {
	it("masks phone numbers as 138****1234", () => {
		expect(maskPhone("13800001234")).toBe("138****1234");
		expect(maskPhone("+86 13800001234")).toBe("138****1234");
		expect(maskPhone("")).toBeNull();
		expect(maskPhone(null)).toBeNull();
		expect(maskPhone(undefined)).toBeNull();
		expect(maskPhone("12345")).toBe("12****45");
	});

	it("masks emails keeping the first letter and the domain", () => {
		expect(maskEmail("alice@example.com")).toBe("a****@example.com");
		expect(maskEmail("x@y.co")).toBe("x****@y.co");
		expect(maskEmail("")).toBeNull();
		expect(maskEmail("no-at-sign")).toBe("n****");
	});

	it("picks the mask by kind", () => {
		expect(maskTarget("phone", "13800001234")).toBe("138****1234");
		expect(maskTarget("email", "alice@example.com")).toBe("a****@example.com");
	});
});

describe("resendLabel", () => {
	it("counts down then invites a resend", () => {
		expect(resendLabel(60)).toBe("60 秒后重新发送");
		expect(resendLabel(1)).toBe("1 秒后重新发送");
		expect(resendLabel(0)).toBe("重新发送验证码");
	});
});
