import type { VerifyKind } from "../api/types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- 验证码登录（手机 / 邮箱，无密码，首次验证即注册） ----

/** 与卡站服务端一致：中国大陆手机号。 */
export const PHONE = /^1[3-9]\d{9}$/;
/** 验证码统一 6 位数字。 */
export const CODE_LENGTH = 6;
const CODE = /^\d{6}$/;

/** 手机号归一：只留数字，去掉用户输入的 +86、空格与横线。 */
export function normalizePhone(input: string): string {
	const digits = input.replace(/\D/g, "");
	return digits.startsWith("86") && digits.length === 13 ? digits.slice(2) : digits;
}

/** 邮箱归一：去空白、转小写。 */
export function normalizeEmail(input: string): string {
	return input.trim().toLowerCase();
}

/** 按方式归一目标；手机走数字归一，邮箱走小写归一。 */
export function normalizeTarget(kind: VerifyKind, input: string): string {
	return kind === "phone" ? normalizePhone(input) : normalizeEmail(input);
}

/** 目标字段的客户端校验；空值交给表单 required，这里只补服务端会拒绝的格式。 */
export function validateTarget(kind: VerifyKind, input: string): string | undefined {
	const raw = input.trim();
	if (!raw) return undefined;
	const value = normalizeTarget(kind, raw);
	if (kind === "phone") return PHONE.test(value) ? undefined : "请输入 11 位手机号";
	return EMAIL_PATTERN.test(value) ? undefined : "邮箱格式不正确";
}

/** 验证码字段：只接受 6 位数字。 */
export function validateCode(input: string): string | undefined {
	const value = input.trim();
	if (!value || CODE.test(value)) return undefined;
	return `请输入 ${CODE_LENGTH} 位数字验证码`;
}

/** 手机号脱敏：138****1234；先按手机规则归一（兼容 +86、空格、横线），其他值只留首尾各 2 位。 */
export function maskPhone(input: string | null | undefined): string | null {
	const value = (input ?? "").trim();
	if (!value) return null;
	const digits = normalizePhone(value);
	if (PHONE.test(digits)) return `${digits.slice(0, 3)}****${digits.slice(7)}`;
	return value.length <= 4 ? "****" : `${value.slice(0, 2)}****${value.slice(-2)}`;
}

/** 邮箱脱敏：保留首字符与域名，中间用 ****，如 a****@example.com。 */
export function maskEmail(input: string | null | undefined): string | null {
	const value = (input ?? "").trim();
	if (!value) return null;
	const at = value.lastIndexOf("@");
	if (at <= 0) return value.length <= 2 ? "****" : `${value.slice(0, 1)}****`;
	const local = value.slice(0, at);
	const domain = value.slice(at + 1);
	return `${local.slice(0, 1)}****@${domain}`;
}

/** 按方式脱敏。 */
export function maskTarget(kind: VerifyKind, input: string | null | undefined): string | null {
	return kind === "phone" ? maskPhone(input) : maskEmail(input);
}

/** 倒计时文案：0 秒时显示「重新发送」。 */
export function resendLabel(seconds: number): string {
	return seconds > 0 ? `${seconds} 秒后重新发送` : "重新发送验证码";
}

/**
 * 验证码表单的界面状态。sending 发码中，countdown 已发出、等用户填码，
 * verifying 校验中，error 停在等码页面并显示失败原因（可重发或改码重试）。
 */
export type VerifyPhase = "idle" | "sending" | "countdown" | "verifying" | "error";

/**
 * 服务端错误码 → 用户能看懂的一句话。未知错误用原始信息，再退回兜底。
 * 分类来自卡站契约：invalid_code/locked 来自 verify，share_* 来自分享链接配额，
 * retryAfter/rate_limited 来自 send，其余按状态码兜底。
 */
export function verifyErrorText(error: unknown, fallback = "验证失败，请重试"): string {
	const code =
		error && typeof error === "object" && "code" in error
			? String((error as { code?: unknown }).code ?? "")
			: error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: "";
	const status =
		error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
	switch (code) {
		case "invalid_code":
			return "验证码不正确，请重新输入";
		case "locked":
			return "尝试次数过多，请稍后再试";
		case "share_exhausted":
			return "这个分享链接的名额已用完，请让分享者重新生成";
		case "share_expired":
			return "这个分享链接已过期，请让分享者重新生成";
		case "share_revoked":
			return "这个分享链接已被撤销，请让分享者重新生成";
		case "rate_limited":
			return "操作太频繁，请稍后再试";
		case "send_failed":
			return "验证码发送失败，请稍后重试";
		case "phone_taken":
			return "这个手机号已绑定其他账号";
		case "email_taken":
			return "这个邮箱已绑定其他账号";
		case "invalid_request":
			return "请检查填写的内容";
		case "history_merge_failed":
			return "历史合并未完成，访客记录已保留，请重试";
	}
	if (status === 429) return "操作太频繁，请稍后再试";
	if (status === 502) return "验证码发送失败，请稍后重试";
	if (status === 401) return "验证码不正确，请重新输入";
	if (status === 403) return "这个分享链接不可用，请让分享者重新生成";
	return code || fallback;
}

/** 发送消息接口在访客额度用尽时返回的错误码。 */
export const VERIFY_REQUIRED = "verify_required";

/** 发消息的错误是否是访客超限（该弹登录窗，而不是普通发送失败）。 */
export function needsVerify(error: unknown): boolean {
	return (
		!!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === VERIFY_REQUIRED
	);
}

/** 默认重发冷却秒数；服务端给了 retryAfter 就以服务端为准。 */
export const RESEND_SECONDS = 60;

export interface VerifyFormState {
	phase: VerifyPhase;
	/** 距离可以重新发送还剩几秒；0 表示现在就能发。 */
	seconds: number;
	/** 是否已经成功发过码（发码失败时不能直接点登录）。 */
	sent: boolean;
	error: string;
}

export const initialVerifyForm: VerifyFormState = { phase: "idle", seconds: 0, sent: false, error: "" };

export type VerifyEvent =
	| { type: "send" }
	| { type: "sent"; retryAfter?: number }
	| { type: "send_failed"; error: unknown; fallback?: string }
	| { type: "verify" }
	| { type: "verify_failed"; error: unknown; fallback?: string }
	| { type: "tick" }
	| { type: "reset" };

/**
 * 验证码表单状态机：idle → sending → countdown → verifying →（成功离开 / 失败回 error）。
 * error 停在等码页面，保留倒计时；用户改码或重发即可继续，不用重新填目标。
 */
export function verifyReducer(state: VerifyFormState, event: VerifyEvent): VerifyFormState {
	switch (event.type) {
		case "send":
			if (state.phase === "sending" || state.phase === "verifying") return state;
			return { ...state, phase: "sending", error: "" };
		case "sent": {
			const retry = event.retryAfter;
			const seconds =
				typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : RESEND_SECONDS;
			return { phase: "countdown", seconds, sent: true, error: "" };
		}
		case "send_failed":
			return {
				...state,
				phase: "error",
				error: verifyErrorText(event.error, event.fallback ?? "验证码发送失败，请重试"),
			};
		case "verify":
			if (state.phase === "verifying" || state.phase === "sending") return state;
			return { ...state, phase: "verifying", error: "" };
		case "verify_failed":
			return { ...state, phase: "error", error: verifyErrorText(event.error, event.fallback ?? "验证失败，请重试") };
		case "tick":
			return state.seconds > 0 ? { ...state, seconds: state.seconds - 1 } : state;
		case "reset":
			return initialVerifyForm;
	}
}

/** 能不能现在点“发送验证码”：发码中/校验中不行，冷却期内不行。 */
export function canSendCode(state: VerifyFormState): boolean {
	return state.phase !== "sending" && state.phase !== "verifying" && state.seconds === 0;
}

/** 能不能点“登录”：已经成功发过码、且不在请求中。 */
export function canVerifyCode(state: VerifyFormState): boolean {
	return state.sent && state.phase !== "sending" && state.phase !== "verifying";
}
