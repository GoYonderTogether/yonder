import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { qk } from "../api/keys";
import { httpApi } from "../api/social";
import { useFacts } from "../lib/queries";
import { AboutSection } from "./settings/AboutSection";
import { NodesSection } from "./settings/NodesSection";
import { NotifySection } from "./settings/NotifySection";
import { accountRows } from "./settings/rows";

/**
 * 「我」/ 头像进入的个人页与设置：账号（网关/社交）、通知、节点、关于（版本、更新）、退出。
 * 社交账号与登录态复用 api/social.ts 的 httpApi 与 qk.socialSession，不在这里另做登录。
 */
export function Settings({ onLogout }: { onLogout(): void }) {
	const facts = useFacts();
	const social = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session, retry: false });
	const socialName = social.data?.actor.name;
	const rows = accountRows(facts.data, socialName);
	return (
		<div className="scroll-y h-full">
			<h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">我</h1>
			<section className="mx-4 mt-2 rounded-card bg-raised p-4 text-small" data-testid="settings">
				<p>已登录 · {facts.data?.kind === "local" ? "本机票据" : "远程访问令牌"}</p>
				<p className="mt-1 text-faint">会话置顶、免打扰和已读位置只保存在这台设备的浏览器里。</p>
			</section>
			<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-account">
				<h2 className="mb-2 text-body font-medium">账号</h2>
				{facts.isLoading && <p className="text-small text-faint">加载中…</p>}
				{facts.isError && <p className="text-small text-danger">{facts.error.message}</p>}
				<dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-small">
					{rows.map((row) => (
						<div key={row.key} className="contents">
							<dt className="text-muted">{row.label}</dt>
							<dd className="min-w-0 break-words">{row.value}</dd>
						</div>
					))}
				</dl>
			</section>
			<NotifySection />
			<NodesSection />
			<AboutSection />
			<button
				type="button"
				onClick={onLogout}
				className="press mx-4 mt-3 mb-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-card bg-raised py-3 text-body text-danger"
			>
				<LogOut size={17} aria-hidden /> 退出登录
			</button>
		</div>
	);
}
