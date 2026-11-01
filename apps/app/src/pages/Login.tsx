import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { ensureRegistrationSupported, passwordApi } from "../api/password";
import type { Session } from "../api/types";
import { selectAccount } from "../cache";
import { CodeForm, VerifyCodeForm } from "../components/VerifySheet";
import { normalizeLoginIdentifier, passwordError, validateNewPassword } from "../lib/password";
import { verifyErrorText } from "../lib/verify";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Logo } from "../ui/Logo";

export function Login() {
	const nav = useNavigate(),
		qc = useQueryClient(),
		loc = useLocation(),
		query = new URLSearchParams(loc.search);
	const candidate = (loc.state as { next?: string } | null)?.next ?? query.get("next") ?? "/";
	const next = /^\/(?!\/)/.test(candidate) && !/[\\\r\n]/.test(candidate) ? candidate : "/";
	const [mode, setMode] = useState<"password" | "code" | "register">(
		query.get("mode") === "register" ? "register" : "password",
	);
	const [identifier, setIdentifier] = useState(""),
		[password, setPassword] = useState(""),
		[confirmation, setConfirmation] = useState(""),
		[name, setName] = useState(""),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const shareToken = query.get("share") ?? undefined;
	const shareStatus = useQuery({
		queryKey: ["share-status", shareToken],
		queryFn: () => api.shareLinkStatus(shareToken ?? ""),
		enabled: !!shareToken,
		retry: false,
	});
	const shareError =
		shareStatus.data && shareStatus.data.state !== "active" ? verifyErrorText({ code: shareStatus.data.state }) : "";
	const done = (session: Session) => {
		setBusy(false);
		selectAccount(session.actor.id, qc);
		$session.set(session);
		nav(next, { replace: true });
	};
	const changeMode = (value: typeof mode) => {
		setMode(value);
		setPassword("");
		setConfirmation("");
		setError("");
	};
	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setError("");
		if (!identifier.trim() || !password) {
			setError("请输入账号和密码");
			return;
		}
		setBusy(true);
		try {
			done(await passwordApi.login(normalizeLoginIdentifier(identifier), password));
		} catch (caught) {
			setError(passwordError(caught));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="scroll-y h-full p-4">
			<div className="rise mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-5 py-8">
				<Logo size={36} />
				<div>
					<h1 className="display">{mode === "register" ? "注册" : "登录"}</h1>
					<p className="mt-2 text-small leading-relaxed text-muted">
						{mode === "register"
							? "验证手机号或邮箱，并设置登录密码。已有账号请直接登录。"
							: mode === "password"
								? "使用手机号、邮箱或账号 ID 登录。"
								: "使用手机号或邮箱接收验证码，首次验证可创建账号。"}
					</p>
				</div>
				{shareError && (
					<p role="alert" className="text-small text-danger">
						{shareError}
					</p>
				)}
				{mode === "password" ? (
					<form onSubmit={submit} className="flex flex-col gap-4">
						<Field
							label="手机号 / 邮箱 / 账号 ID"
							autoComplete="username"
							type="text"
							value={identifier}
							onChange={(e) => setIdentifier(e.target.value)}
							maxLength={254}
							required
							disabled={busy}
						/>
						<Field
							label="密码"
							type="password"
							passwordToggle
							autoComplete="current-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							maxLength={128}
							required
							disabled={busy}
						/>
						{error && (
							<p role="alert" className="text-small text-danger">
								{error}
							</p>
						)}
						<Button type="submit" variant="primary" className="h-11" disabled={busy}>
							{busy ? "登录中…" : "登录"}
						</Button>
					</form>
				) : mode === "code" ? (
					<VerifyCodeForm shareToken={shareToken} onSuccess={done} onBusyChange={setBusy} />
				) : (
					<CodeForm
						key="registration"
						onBusyChange={setBusy}
						send={async (input) => {
							try {
								await ensureRegistrationSupported();
							} catch (error) {
								throw Object.assign(new Error(passwordError(error)), {
									retryAfter:
										error && typeof error === "object" && "retryAfter" in error ? error.retryAfter : undefined,
								});
							}
							return api.sendCode({ ...input, ...(shareToken ? { shareToken } : {}) });
						}}
						confirm={(input) => {
							const invalid = validateNewPassword(password, confirmation);
							if (invalid) throw new Error(invalid);
							return passwordApi
								.register({
									...input,
									password,
									...(name.trim() ? { name: name.trim() } : {}),
									...(shareToken ? { shareToken } : {}),
								})
								.catch((error) => {
									throw Object.assign(new Error(passwordError(error)), {
										retryAfter:
											error && typeof error === "object" && "retryAfter" in error ? error.retryAfter : undefined,
									});
								});
						}}
						onSuccess={done}
						submitLabel="验证并注册"
						doneHint="验证码已发送，验证成功后创建账号。"
					>
						<Field
							label="昵称（选填）"
							value={name}
							maxLength={80}
							autoComplete="nickname"
							onChange={(e) => setName(e.target.value)}
						/>
						<Field
							label="设置密码"
							type="password"
							passwordToggle
							autoComplete="new-password"
							minLength={8}
							maxLength={128}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder="8–128 位"
							required
						/>
						<Field
							label="确认密码"
							type="password"
							passwordToggle
							autoComplete="new-password"
							minLength={8}
							maxLength={128}
							value={confirmation}
							onChange={(e) => setConfirmation(e.target.value)}
							required
						/>
					</CodeForm>
				)}
				<div className="flex flex-wrap justify-between gap-3 text-small">
					<button
						type="button"
						className="press min-h-11 text-muted hover:text-ink"
						disabled={busy}
						onClick={() => changeMode(mode === "password" ? "code" : "password")}
					>
						{mode === "password" ? "验证码登录 / 忘记密码" : "密码登录"}
					</button>
					<button
						type="button"
						className="press min-h-11 text-muted hover:text-ink"
						disabled={busy}
						onClick={() => changeMode(mode === "register" ? "password" : "register")}
					>
						{mode === "register" ? "已有账号？登录" : "注册新账号"}
					</button>
				</div>
				{mode === "code" && (
					<p className="text-caption leading-relaxed text-muted">
						忘记密码？验证码登录后，可在「设置 → 账号与安全」重置密码。
					</p>
				)}
			</div>
		</div>
	);
}
