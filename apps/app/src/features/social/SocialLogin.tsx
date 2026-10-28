import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { qk } from "../../api/keys";
import { httpApi } from "../../api/social";
import { href, parse } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
import { Logo } from "../../ui/kit/Logo";
import { toast } from "../../ui/kit/Toast";

export function SocialLogin() {
	const qc = useQueryClient();
	const query = new URLSearchParams(location.search);
	const [mode, setMode] = useState<"login" | "register">(query.get("mode") === "register" ? "register" : "login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError("");
		try {
			const session = await (mode === "login"
				? httpApi.login({ email, password })
				: httpApi.register({ email, password, name }));
			qc.setQueryData(qk.socialSession, session);
			// TODO: use a shared account-switch cache contract when one is available.
			const next = query.get("next");
			location.hash = href(next?.match(/^\/(?!\/)/) ? parse(`#${next}`) : { tab: "chats" });
		} catch (err) {
			setError(
				err instanceof Error
					? err.message.includes("history_merge_failed")
						? "历史合并未完成，访客记录已保留，请重试"
						: err.message
					: "失败",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="flex h-full items-center justify-center p-4">
			<form onSubmit={submit} className="rise flex w-full max-w-sm flex-col gap-5">
				<Logo size={36} />
				<h1 className="display">{mode === "login" ? "登录" : "注册"}</h1>
				{mode === "register" && <Field label="昵称" value={name} onChange={(e) => setName(e.target.value)} />}
				<Field
					label="邮箱"
					onFocus={() => toast("邮箱只当登录名，不验证，也不发验证码")}
					type="text"
					inputMode="email"
					autoComplete="username"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
				/>
				<Field
					label="密码"
					type="password"
					passwordToggle
					autoComplete={mode === "login" ? "current-password" : "new-password"}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
				/>
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
					className="press self-start text-[14px] text-muted hover:text-ink"
					onClick={() => setMode(mode === "login" ? "register" : "login")}
				>
					{mode === "login" ? "没有账号？注册" : "已有账号？登录"}
				</button>
			</form>
		</div>
	);
}
