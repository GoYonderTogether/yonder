import { useQueryClient } from "@tanstack/react-query";
import { qk } from "../../api/keys";
import type { Session } from "../../api/social";
import { href, parse } from "../../shell/routes";
import { Logo } from "../../ui/kit/Logo";
import { VerifyCodeForm } from "./VerifySheet";

/**
 * 登录 / 注册页：手机或邮箱验证码，首次验证即注册，不设密码。
 * 访客在外壳里已经能聊天，这里也承接「登录后加好友、管理 Agent」的升级入口；
 * 分享链接带进来的 shareToken 只在表单里透传，不做额外解释。
 */
export function SocialLogin({ shareToken, onDone }: { shareToken?: string; onDone?(session: Session): void }) {
	const qc = useQueryClient();
	const query = new URLSearchParams(location.search);
	const done = (session: Session) => {
		qc.setQueryData(qk.socialSession, session);
		// TODO: use a shared account-switch cache contract when one is available.
		if (onDone) {
			onDone(session);
			return;
		}
		const next = query.get("next");
		location.hash = href(next?.match(/^\/(?!\/)/) ? parse(`#${next}`) : { tab: "chats" });
	};
	return (
		<div className="flex h-full items-center justify-center p-4">
			<div className="rise flex w-full max-w-sm flex-col gap-5">
				<Logo size={36} />
				<div>
					<h1 className="display">登录或注册</h1>
					<p className="mt-1 text-small text-muted">用手机号或邮箱收验证码，首次验证即注册，不需要密码。</p>
				</div>
				<VerifyCodeForm shareToken={shareToken} onSuccess={done} submitLabel="登录 / 注册" />
			</div>
		</div>
	);
}
