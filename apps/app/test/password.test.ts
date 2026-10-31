import { afterEach, describe, expect, it, vi } from "vitest";
import { passwordApi } from "../src/api/password";
import { normalizeLoginIdentifier, passwordError, validateNewPassword } from "../src/lib/password";
import { canSendCode, initialVerifyForm, verifyReducer } from "../src/lib/verify";

afterEach(() => vi.unstubAllGlobals());
it("normalizes phone, email and public account IDs without treating names as identifiers", () => {
	expect(normalizeLoginIdentifier("+86 138-0013-8000")).toBe("13800138000");
	expect(normalizeLoginIdentifier(" Person@Example.COM ")).toBe("person@example.com");
	expect(normalizeLoginIdentifier("ab12cd")).toBe("AB12CD");
});
it("new passwords are bounded, confirmed and never trimmed", () => {
	expect(validateNewPassword("1234567", "1234567")).toBeTruthy();
	expect(validateNewPassword("a".repeat(129), "a".repeat(129))).toBeTruthy();
	expect(validateNewPassword("goodpass", "different")).toBeTruthy();
	expect(validateNewPassword(" goodpass ", " goodpass ")).toBeUndefined();
});
it("describes old-account registration, credentials and unavailable features honestly", () => {
	expect(passwordError(new Error("account_exists"))).toContain("账号已存在");
	expect(passwordError(new Error("invalid_credentials"))).toBe("账号或密码不正确");
	expect(passwordError(Object.assign(new Error("not_found"), { status: 404 }))).toContain("尚未启用");
	expect(passwordError(new Error("contact_not_bound"))).toContain("先绑定");
});
it("a server cooldown on a failed send prevents immediately sending again", () => {
	const state = verifyReducer(initialVerifyForm, { type: "send_failed", error: { retryAfter: 37, status: 429 } });
	expect(state.seconds).toBe(37);
	expect(state.sent).toBe(false);
	expect(canSendCode(state)).toBe(false);
});
function respond(status: number, body: unknown) {
	vi.stubGlobal("window", { dispatchEvent: vi.fn() });
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(JSON.stringify(body), { status })),
	);
}
describe("real HTTP password adapter contract", () => {
	it("password login sends identifier without target or OTP and keeps a bad-password error local", async () => {
		respond(401, { error: "invalid_credentials" });
		const error = await passwordApi.login("AB12CD", "incorrect").catch((e) => e);
		expect(passwordError(error)).toBe("账号或密码不正确");
		expect(window.dispatchEvent).not.toHaveBeenCalled();
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/auth/password/login");
		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
			identifier: "AB12CD",
			password: "incorrect",
		});
	});
	it("registration preserves verified target, password and share attribution", async () => {
		respond(409, { error: "account_exists" });
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(JSON.stringify({ passwordRegistration: true }), { status: 200 }),
		);
		await passwordApi
			.register({ kind: "phone", target: "13800138000", code: "000000", password: "newpassword", shareToken: "share" })
			.catch(() => {});
		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
			password: "newpassword",
			shareToken: "share",
			code: "000000",
		});
	});
	it("reset code sending only names a verified channel; no editable target is sent", async () => {
		respond(200, { sent: true, retryAfter: 60 });
		await passwordApi.sendResetCode("phone");
		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ kind: "phone" });
	});
	it("an incorrect reset OTP does not expire the current login", async () => {
		respond(401, { error: "invalid_code" });
		await passwordApi.reset("email", "000000", "newpassword").catch(() => {});
		expect(window.dispatchEvent).not.toHaveBeenCalled();
		expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
			kind: "email",
			code: "000000",
			password: "newpassword",
		});
	});
	it("a genuinely expired reset session still expires the current login", async () => {
		respond(401, { error: "unauthorized" });
		await passwordApi.reset("phone", "000000", "newpassword").catch(() => {});
		expect(window.dispatchEvent).toHaveBeenCalledOnce();
	});
});

it("old servers cannot silently register an account without its requested password", async () => {
	respond(404, { error: "not_found" });
	await expect(
		passwordApi.register({ kind: "phone", target: "13800138000", code: "000000", password: "newpassword" }),
	).rejects.toThrow();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/auth/password/capabilities");
});
it("registration requires an explicit enabled capability, not an old response shape", async () => {
	respond(200, {});
	await expect(
		passwordApi.register({ kind: "phone", target: "13800138000", code: "000000", password: "newpassword" }),
	).rejects.toThrow("password_registration_unavailable");
	expect(fetch).toHaveBeenCalledTimes(1);
});
it("a registration session without passwordSet is not reported as a successful password registration", async () => {
	respond(200, { actor: { id: "verified-account" } });
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ passwordRegistration: true }), { status: 200 }));
	await expect(
		passwordApi.register({ kind: "phone", target: "13800138000", code: "000000", password: "newpassword" }),
	).rejects.toThrow("password_registration_unconfirmed");
});
