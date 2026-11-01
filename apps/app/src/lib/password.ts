import { normalizeEmail, normalizePhone, PHONE, verifyErrorText } from "./verify";
export function normalizeLoginIdentifier(value: string) {
	const raw = value.trim();
	if (raw.includes("@")) return normalizeEmail(raw);
	const phone = normalizePhone(raw);
	return /^[+\d\s()-]+$/.test(raw) && PHONE.test(phone) ? phone : raw.toUpperCase();
}
export function validateNewPassword(password: string, confirmation: string) {
	if (password.length < 8 || password.length > 128) return "密码长度为 8–128 位";
	if (password !== confirmation) return "两次输入的密码不一致";
	return undefined;
}
export function passwordError(error: unknown) {
	const message = error instanceof Error ? error.message : "";
	const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
	if (status === 404) return "服务器尚未启用密码功能，请稍后重试。";
	if (message === "password_registration_unavailable") return "服务器尚未启用密码注册，请稍后重试。";
	if (message === "password_registration_unconfirmed") return "服务器未确认密码设置，请用验证码登录后重置密码。";
	if (message === "account_exists") return "账号已存在，请登录；忘记密码可先用验证码登录，再到设置重置。";
	if (message === "contact_not_bound") return "请先绑定并验证手机号或邮箱，再重置密码。";
	if (message === "invalid_credentials") return "账号或密码不正确";
	if (message === "invalid_password") return "密码长度为 8–128 位";
	if (message === "unauthorized") return "登录已过期，请重新登录";
	return verifyErrorText(error, "请求失败，请重试");
}
