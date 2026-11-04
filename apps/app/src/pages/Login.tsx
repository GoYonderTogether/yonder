import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../api";
import type { Session } from "../api/types";
import { selectAccount } from "../cache";
import { VerifyCodeForm } from "../components/VerifySheet";
import { verifyErrorText } from "../lib/verify";
import { $session } from "../store";
import { Logo } from "../ui/Logo";

export function Login() {
	const nav = useNavigate(),
		qc = useQueryClient(),
		loc = useLocation(),
		query = new URLSearchParams(loc.search);
	const candidate = (loc.state as { next?: string } | null)?.next ?? query.get("next") ?? "/";
	const next = /^\/(?!\/)/.test(candidate) && !/[\\\r\n]/.test(candidate) ? candidate : "/";
	const [, setBusy] = useState(false);
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
	return (
		<div className="scroll-y app-frame p-4">
			<div className="rise mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-5 py-8">
				<Logo size={36} />
				<div>
					<h1 className="display">登录</h1>
					<p className="mt-2 text-small leading-relaxed text-muted">使用手机号接收验证码，首次验证会直接创建账号。</p>
				</div>
				{shareError && (
					<p role="alert" className="text-small text-danger">
						{shareError}
					</p>
				)}
				<VerifyCodeForm shareToken={shareToken} onSuccess={done} onBusyChange={setBusy} />
			</div>
		</div>
	);
}
