import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { ShareLink, ShareLinkKind } from "../api/types";
import { rememberShareToken, shareLinkKey, shareLinkUrl, shareLinkView, storedShareTokens } from "../lib/shareLinks";
import { messageOf } from "../lib/verify";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";
import { Window } from "../ui/Window";

/** 新建链接的默认配额：与服务端 shareLinkDefaultUses / shareLinkTtlDays 一致；显式传参才保证是一条新链接。 */
const DEFAULT_USES = 50;
const DEFAULT_DAYS = 7;

/** 入口按钮 + 管理窗。窗口只在打开时挂载列表，没打开就不发任何请求。 */
export function ShareLinks({
	kind,
	targetId,
	label,
	path,
}: {
	kind: ShareLinkKind;
	targetId: string;
	/** 窗口标题里的对象名，如名片主人或群名 */
	label?: string;
	/** 二维码落地页的路径（/u/<码>、/g/<邀请 token>）；复制出来的链接带上它 */
	path: string;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button size="sm" onClick={() => setOpen(true)}>
				分享链接
			</Button>
			<Window open={open} onOpenChange={setOpen} title={`分享链接${label ? ` · ${label}` : ""}`}>
				{open && <ShareLinkList kind={kind} targetId={targetId} path={path} />}
			</Window>
		</>
	);
}

export function ShareLinkList({ kind, targetId, path }: { kind: ShareLinkKind; targetId: string; path: string }) {
	const key = shareLinkKey(kind, targetId);
	// 本机索引：新建后更新本地状态，列表查询的 key 随之变化。
	const [tokens, setTokens] = useState(() => storedShareTokens(key));
	const [maxUses, setMaxUses] = useState("");
	const [days, setDays] = useState("");
	const [formError, setFormError] = useState("");
	const links = useQuery({
		queryKey: ["share-links", key, tokens.join(",")],
		queryFn: async () => {
			const found = await Promise.all(tokens.map((token) => api.getShareLink(token)));
			return found.filter((link): link is ShareLink => !!link);
		},
		enabled: tokens.length > 0,
	});
	const create = useMutation({
		mutationFn: (input: { maxUses: number; expiresAt: string }) => api.createShareLink({ kind, targetId, ...input }),
		onSuccess: (link) => {
			setTokens(rememberShareToken(key, link.token));
			setMaxUses("");
			setDays("");
			toast("已生成新分享链接");
		},
		onError: (error) => toast(messageOf(error, "生成失败"), true),
	});
	const revoke = useMutation({
		mutationFn: (token: string) => api.revokeShareLink(token),
		// 吊销后保留在列表里显示「已撤销」，让人看得出这条已经作废。
		onSuccess: () => {
			void links.refetch();
			toast("已吊销分享链接");
		},
		onError: (error) => toast(messageOf(error, "吊销失败"), true),
	});
	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		const uses = maxUses.trim() ? Number(maxUses) : DEFAULT_USES;
		const dayCount = days.trim() ? Number(days) : DEFAULT_DAYS;
		if (!Number.isInteger(uses) || uses < 1 || uses > 1000) return setFormError("可用次数请填 1 到 1000 之间的整数");
		if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 366)
			return setFormError("有效天数请填 1 到 366 之间的整数");
		setFormError("");
		create.mutate({ maxUses: uses, expiresAt: new Date(Date.now() + dayCount * 86_400_000).toISOString() });
	};
	// 复制反馈自熄：对勾微弹出现，2.5 秒后淡出恢复（.pop / .feedback）
	const [copied, setCopied] = useState<string | null>(null);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(null), 2500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	const copy = (link: ShareLink) => {
		const url = shareLinkUrl(link, path, location.origin);
		void navigator.clipboard.writeText(url).then(
			() => setCopied(link.token),
			() => toast("复制失败，请手动复制", true),
		);
	};
	return (
		<div className="flex max-h-[calc(90dvh-3rem)] flex-col gap-3 overflow-y-auto p-5">
			<p className="text-small text-muted">只显示这台设备生成过的链接；每行是一份独立配额。</p>
			<form onSubmit={submit} aria-label="新建分享链接" className="flex flex-col gap-3 rounded-control bg-tone p-3">
				<div className="grid grid-cols-2 gap-3">
					<Field
						label="可用次数"
						type="number"
						inputMode="numeric"
						min={1}
						max={1000}
						placeholder={String(DEFAULT_USES)}
						value={maxUses}
						onChange={(e) => setMaxUses(e.target.value)}
					/>
					<Field
						label="有效天数"
						type="number"
						inputMode="numeric"
						min={1}
						max={366}
						placeholder={String(DEFAULT_DAYS)}
						value={days}
						onChange={(e) => setDays(e.target.value)}
					/>
				</div>
				{formError && (
					<p role="alert" className="text-small text-danger">
						{formError}
					</p>
				)}
				<Button type="submit" variant="primary" className="h-11" disabled={create.isPending}>
					{create.isPending ? "生成中…" : "新建分享链接"}
				</Button>
			</form>
			{links.isPending && tokens.length > 0 ? (
				<p role="status" className="text-small text-muted">
					正在加载分享链接…
				</p>
			) : links.isError ? (
				<div role="alert" className="flex items-center gap-2 text-small">
					加载分享链接失败
					<Button size="sm" onClick={() => void links.refetch()}>
						重试
					</Button>
				</div>
			) : !tokens.length ? (
				<p role="status" className="text-small text-muted">
					还没有生成过分享链接。点上面的「新建分享链接」生成一条。
				</p>
			) : !links.data?.length ? (
				<p role="status" className="text-small text-muted">
					本机记录的链接已失效或不属于当前账号。
				</p>
			) : (
				<ul aria-label="分享链接列表" className="divide-y divide-hairline/60">
					{links.data.map((link) => {
						const view = shareLinkView(link);
						return (
							<li key={link.token} className="flex flex-col gap-2 py-3">
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-small" title={link.token}>
										{view.shortToken}
									</span>
									<span className="text-caption text-muted">已用 {view.usageText}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className={view.usable ? "text-caption text-muted" : "text-caption text-danger"}>
										{view.usable ? `${view.expiryText} · 可用` : view.stateText}
									</span>
									<span className="flex gap-2">
										<Button size="sm" disabled={!view.usable} onClick={() => copy(link)}>
											{copied === link.token ? (
												<span className="inline-flex items-center gap-1 text-muted">
													<Check size={13} className="pop" aria-hidden />
													已复制
												</span>
											) : (
												"复制"
											)}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											disabled={!view.usable || revoke.isPending}
											onClick={() => revoke.mutate(link.token)}
										>
											吊销
										</Button>
									</span>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
