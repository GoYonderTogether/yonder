import { describe, expect, it } from "vitest";
import type { Session } from "../src/api/social/types";
import {
	messageOf,
	PASSWORD_MIN,
	socialLoginInput,
	socialRegisterInput,
	socialSessionState,
	validateSocialForm,
} from "../src/features/social/lib/session";

const human: Session = { actor: { id: "u1", name: "正式账号", kind: "human" } };
const anonymous: Session = { actor: { id: "a1", name: "访客", kind: "human", anonymous: true } };

describe("socialSessionState", () => {
	it("is unknown while the query has no data and no error", () => {
		expect(socialSessionState({ data: undefined })).toEqual({ status: "unknown" });
		expect(socialSessionState({ data: undefined, error: null })).toEqual({ status: "unknown" });
	});
	it("is guest when the API explicitly returns no session", () => {
		expect(socialSessionState({ data: null })).toEqual({ status: "guest" });
	});
	it("is anonymous for a visitor account", () => {
		expect(socialSessionState({ data: anonymous })).toEqual({ status: "anonymous", actor: anonymous.actor });
	});
	it("is human for a registered account", () => {
		expect(socialSessionState({ data: human })).toEqual({ status: "human", actor: human.actor });
	});
	it("is error when the request failed without data", () => {
		expect(socialSessionState({ data: undefined, error: new Error("网络错误") })).toEqual({
			status: "error",
			message: "网络错误",
		});
	});
	it("keeps the signed-in state when a background refresh fails", () => {
		expect(socialSessionState({ data: human, error: new Error("刷新失败") })).toEqual({
			status: "human",
			actor: human.actor,
		});
	});
	it("distinguishes an empty session from a failure", () => {
		expect(socialSessionState({ data: null, error: new Error("失败") })).toEqual({ status: "guest" });
	});
});

describe("messageOf", () => {
	it("uses the error message, then a string, then the fallback", () => {
		expect(messageOf(new Error("boom"))).toBe("boom");
		expect(messageOf("直接文本")).toBe("直接文本");
		expect(messageOf(new Error(""))).toBe("请求失败");
		expect(messageOf(undefined)).toBe("请求失败");
		expect(messageOf({ weird: true }, "失败")).toBe("失败");
	});
});

describe("validateSocialForm", () => {
	it("accepts a valid login form", () => {
		expect(validateSocialForm("login", { email: "a@b.co", password: "12345678", name: "" })).toEqual({});
	});
	it("rejects a malformed email", () => {
		expect(validateSocialForm("login", { email: "a@b", password: "12345678", name: "" }).email).toBe("邮箱格式不正确");
		expect(validateSocialForm("login", { email: "no-at", password: "12345678", name: "" }).email).toBe(
			"邮箱格式不正确",
		);
		expect(validateSocialForm("login", { email: "a b@c.de", password: "12345678", name: "" }).email).toBe(
			"邮箱格式不正确",
		);
	});
	it("requires at least the server's password length", () => {
		expect(PASSWORD_MIN).toBe(8);
		expect(validateSocialForm("login", { email: "a@b.co", password: "1234567", name: "" }).password).toBe(
			"密码至少 8 位",
		);
		expect(validateSocialForm("login", { email: "a@b.co", password: "12345678", name: "" }).password).toBeUndefined();
	});
	it("requires a nickname when registering", () => {
		expect(validateSocialForm("register", { email: "a@b.co", password: "12345678", name: "  " }).name).toBe(
			"请填写昵称",
		);
		expect(
			validateSocialForm("register", { email: "a@b.co", password: "12345678", name: "阿明" }).name,
		).toBeUndefined();
	});
	it("rejects control characters in the nickname", () => {
		expect(validateSocialForm("register", { email: "a@b.co", password: "12345678", name: "a\u0000b" }).name).toBe(
			"昵称包含不可用字符",
		);
	});
	it("leaves empty fields to the form's required check", () => {
		expect(validateSocialForm("login", { email: "", password: "", name: "" })).toEqual({});
	});
	it("reports every invalid field at once", () => {
		expect(validateSocialForm("register", { email: "bad", password: "short", name: "" })).toEqual({
			email: "邮箱格式不正确",
			password: "密码至少 8 位",
			name: "请填写昵称",
		});
	});
});

describe("form input mapping", () => {
	it("trims and lowercases the email, keeps the password verbatim", () => {
		expect(socialLoginInput({ email: "  A@B.CO ", password: " Pass Word ", name: "x" })).toEqual({
			email: "a@b.co",
			password: " Pass Word ",
		});
	});
	it("sends the trimmed nickname on register", () => {
		expect(socialRegisterInput({ email: "a@b.co", password: "12345678", name: "  阿明  " })).toEqual({
			email: "a@b.co",
			password: "12345678",
			name: "阿明",
		});
	});
});
