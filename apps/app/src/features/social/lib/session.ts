import type { Actor, Session } from "../../../api/social/types";

/**
 * 社交登录态在界面上该显示什么。只消费 useQuery 拿到的 session 数据与错误，
 * 不管理令牌、不发请求；所有分支都是纯函数，可以直接测。
 *
 * - unknown：还没拿到结果（首次加载，或查询被禁用）
 * - guest：服务端明确说没有会话（/api/session 返回 null）
 * - anonymous：访客账号，能聊天、不能加好友
 * - human：正式账号
 * - error：请求失败且没有可用数据
 */
export type SocialSessionState =
	| { status: "unknown" }
	| { status: "guest" }
	| { status: "anonymous"; actor: Actor }
	| { status: "human"; actor: Actor }
	| { status: "error"; message: string };

export interface SocialSessionInput {
	data: Session | null | undefined;
	error?: unknown;
}

/** 有数据就以数据为准：后台刷新失败不该把已经拿到的结果打回错误页，服务端说「没有会话」也是一个结果。 */
export function socialSessionState({ data, error }: SocialSessionInput): SocialSessionState {
	if (data !== undefined) {
		if (data === null) return { status: "guest" };
		const { actor } = data;
		return actor.anonymous ? { status: "anonymous", actor } : { status: "human", actor };
	}
	if (error) return { status: "error", message: messageOf(error) };
	return { status: "unknown" };
}

/** 把任意错误变成可显示的一句话，不把空消息或非 Error 值漏到界面上。 */
export function messageOf(error: unknown, fallback = "请求失败"): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}

export type SocialMode = "login" | "register";

export interface SocialFormValues {
	email: string;
	password: string;
	name: string;
}

export type SocialFieldErrors = Partial<Record<keyof SocialFormValues, string>>;

/** 与服务端一致（server/src/auth.ts credentials）：密码至少 8 位，邮箱要带 @ 和点。 */
export const PASSWORD_MIN = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL = /\p{Cc}/u;

/**
 * 客户端校验，规则取自服务端：邮箱格式、密码长度、注册昵称非空且不含控制字符。
 * 空值交给表单的 required 原生校验，这里只补服务端会拒绝的格式与长度。
 */
export function validateSocialForm(mode: SocialMode, values: SocialFormValues): SocialFieldErrors {
	const errors: SocialFieldErrors = {};
	if (values.email && !EMAIL.test(values.email.trim())) errors.email = "邮箱格式不正确";
	if (values.password && values.password.length < PASSWORD_MIN) errors.password = `密码至少 ${PASSWORD_MIN} 位`;
	if (mode === "register") {
		const name = values.name.trim();
		if (!name) errors.name = "请填写昵称";
		else if (CONTROL.test(name)) errors.name = "昵称包含不可用字符";
	}
	return errors;
}

/** 登录名按服务端规则归一：去空白、小写；密码原样提交。 */
export function socialLoginInput(values: SocialFormValues): { email: string; password: string } {
	return { email: values.email.trim().toLowerCase(), password: values.password };
}

export function socialRegisterInput(values: SocialFormValues): { email: string; password: string; name: string } {
	return { ...socialLoginInput(values), name: values.name.trim() };
}
