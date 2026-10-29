import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { qk } from "../../api/keys";
import { httpApi } from "../../api/social";
import { href, parse } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
import { Logo } from "../../ui/kit/Logo";
import { toast } from "../../ui/kit/Toast";
import {
	messageOf,
	type SocialFieldErrors,
	type SocialMode,
	socialLoginInput,
	socialRegisterInput,
	validateSocialForm,
} from "./lib/session";

export function SocialLogin() {
	const qc = useQueryClient();
	const query = new URLSearchParams(location.search);
	const [mode, setMode] = useState<SocialMode>(query.get("mode") === "register" ? "register" : "login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [fieldErrors, setFieldErrors] = useState<SocialFieldErrors>({});
	const emailError = useId();
	const passwordError = useId();
	const nameError = useId();

	/** 改哪个字段就清哪个字段的错误；提交失败的错误保留到下次提交，不丢用户输入。 */
	function edit(field: "email" | "password" | "name", value: string) {
		if (field === "email") setEmail(value);
		else if (field === "password") setPassword(value);
		else setName(value);
		if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: undefined });
	}

	function switchMode() {
		setMode(mode === "login" ? "register" : "login");
		setError("");
		setFieldErrors({});
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (busy) return;
		// 空值交给 input 的 required；这里只补服务端会拒绝的格式与长度。
		const errors = validateSocialForm(mode, { email, password, name });
		if (Object.values(errors).some(Boolean)) {
			setFieldErrors(errors);
			setError("");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const session = await (mode === "login"
				? httpApi.login(socialLoginInput({ email, password, name }))
				: httpApi.register(socialRegisterInput({ email, password, name })));
			qc.setQueryData(qk.socialSession, session);
			// TODO: use a shared account-switch cache contract when one is available.
			const next = query.get("next");
			location.hash = href(next?.match(/^\/(?!\/)/) ? parse(`#${next}`) : { tab: "chats" });
		} catch (err) {
			const raw = messageOf(err, "失败");
			setError(raw.includes("history_merge_failed") ? "历史合并未完成，访客记录已保留，请重试" : raw);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex h-full items-center justify-center p-4">
			<form onSubmit={submit} className="rise flex w-full max-w-sm flex-col gap-5">
				<Logo size={36} />
				<h1 className="display">{mode === "login" ? "登录" : "注册"}</h1>
				{mode === "register" && (
					<div className="flex flex-col gap-1">
						<Field
							label="昵称"
							value={name}
							onChange={(e) => edit("name", e.target.value)}
							disabled={busy}
							aria-invalid={!!fieldErrors.name}
							aria-describedby={fieldErrors.name ? nameError : undefined}
						/>
						{fieldErrors.name && (
							<p id={nameError} className="text-[13px] text-danger">
								{fieldErrors.name}
							</p>
						)}
					</div>
				)}
				<div className="flex flex-col gap-1">
					<Field
						label="邮箱"
						onFocus={() => toast("邮箱只当登录名，不验证，也不发验证码")}
						type="text"
						inputMode="email"
						autoComplete="username"
						value={email}
						onChange={(e) => edit("email", e.target.value)}
						disabled={busy}
						required
						aria-invalid={!!fieldErrors.email}
						aria-describedby={fieldErrors.email ? emailError : undefined}
					/>
					{fieldErrors.email && (
						<p id={emailError} className="text-[13px] text-danger">
							{fieldErrors.email}
						</p>
					)}
				</div>
				<div className="flex flex-col gap-1">
					<Field
						label="密码"
						type="password"
						passwordToggle
						autoComplete={mode === "login" ? "current-password" : "new-password"}
						value={password}
						onChange={(e) => edit("password", e.target.value)}
						disabled={busy}
						required
						aria-invalid={!!fieldErrors.password}
						aria-describedby={fieldErrors.password ? passwordError : undefined}
					/>
					{fieldErrors.password && (
						<p id={passwordError} className="text-[13px] text-danger">
							{fieldErrors.password}
						</p>
					)}
				</div>
				{error && (
					<p role="alert" className="text-[13px] text-danger">
						{error}
					</p>
				)}
				<Button variant="primary" disabled={busy} className="h-11">
					{mode === "login" ? "登录" : "创建账号"}
				</Button>
				<button
					type="button"
					className="press self-start text-[14px] text-muted hover:text-ink disabled:opacity-40"
					disabled={busy}
					onClick={switchMode}
				>
					{mode === "login" ? "没有账号？注册" : "已有账号？登录"}
				</button>
			</form>
		</div>
	);
}
