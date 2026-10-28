import { KeyRound } from "lucide-react";
import { useState } from "react";
import mark from "../assets/brand/yonder-mark.svg?inline"; // 内联：登出后网关会把未登录的静态资源请求重定向到登录页
import { login } from "../transport/client";

/** 粘贴访问令牌（`yonder ui token` 生成）换登录 cookie；令牌不在前端保存。 */
export function Login({ onDone }: { onDone(): void }) {
	const [token, setToken] = useState("");
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!token.trim()) return;
		setBusy(true);
		setErr("");
		try {
			await login(token.trim());
			setToken("");
			onDone();
		} catch (x) {
			setErr(x instanceof Error ? x.message : "登录失败");
		} finally {
			setBusy(false);
		}
	};
	return (
		<main className="grid min-h-dvh place-items-center bg-ground px-6">
			<form onSubmit={submit} className="w-full max-w-sm rounded-card bg-raised p-6 shadow-float" data-testid="login">
				<img src={mark} alt="" className="mb-4 size-10" />
				<h1 className="text-title font-semibold">登录 Yonder 控制台</h1>
				<p className="mt-1 text-small text-muted">
					在运行 Yonder 的电脑上执行 <code className="font-mono">yonder ui token</code>，把访问令牌粘贴到这里。
				</p>
				<label htmlFor="token" className="mt-5 block text-small font-medium">
					访问令牌
				</label>
				<div className="field mt-1.5 flex items-center gap-2 rounded-control bg-tone px-3 py-2.5">
					<KeyRound size={16} className="text-faint" aria-hidden />
					<input
						id="token"
						type="password"
						autoComplete="current-password"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder="粘贴令牌"
						className="min-w-0 flex-1 bg-transparent font-mono text-small outline-none placeholder:text-faint"
					/>
				</div>
				{err && (
					<p role="alert" className="mt-2 text-small text-danger">
						{err}
					</p>
				)}
				<button
					type="submit"
					disabled={busy || !token.trim()}
					className="press mt-5 w-full rounded-full bg-accent py-2.5 text-body font-medium text-on-accent disabled:opacity-40"
				>
					{busy ? "登录中…" : "登录"}
				</button>
			</form>
		</main>
	);
}
