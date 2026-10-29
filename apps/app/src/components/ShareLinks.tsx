import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { ShareLink, ShareLinkKind } from "../api/types";
import { shareLinkKey, shareLinkUrl, shareLinkView, storedShareTokens } from "../lib/shareLinks";
import { messageOf } from "../lib/verify";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { Window } from "../ui/Window";

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
	/** 二维码落地页的路径（/u/…、/p/…、/g/…）；复制出来的链接带上它 */
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

function ShareLinkList({ kind, targetId, path }: { kind: ShareLinkKind; targetId: string; path: string }) {
	const key = shareLinkKey(kind, targetId);
	// 每次打开窗口读一次本机索引：生成发生在外面，窗口重新挂载就能看到新 token。
	const tokens = storedShareTokens(key);
	const links = useQuery({
		queryKey: ["share-links", key, tokens],
		queryFn: async () => {
			const found = await Promise.all(tokens.map((token) => api.getShareLink(token)));
			return found.filter((link): link is ShareLink => !!link);
		},
		enabled: tokens.length > 0,
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
	const copy = (link: ShareLink) => {
		const url = shareLinkUrl(link, path, location.origin);
		void navigator.clipboard.writeText(url).then(
			() => toast("链接已复制"),
			() => toast("复制失败，请手动复制", true),
		);
	};
	return (
		<div className="flex max-h-[calc(90dvh-3rem)] flex-col gap-3 overflow-y-auto p-5">
			<p className="text-[13px] text-muted">只显示这台设备生成过的链接；每行是一份独立配额。</p>
			{links.isPending && tokens.length > 0 ? (
				<p role="status" className="text-[13px] text-muted">
					正在加载分享链接…
				</p>
			) : links.isError ? (
				<div role="alert" className="flex items-center gap-2 text-[13px]">
					加载分享链接失败
					<Button size="sm" onClick={() => void links.refetch()}>
						重试
					</Button>
				</div>
			) : !tokens.length ? (
				<p role="status" className="text-[13px] text-muted">
					还没有生成过分享链接。生成二维码或群邀请后会出现在这里。
				</p>
			) : !links.data?.length ? (
				<p role="status" className="text-[13px] text-muted">
					本机记录的链接已失效或不属于当前账号。
				</p>
			) : (
				<ul aria-label="分享链接列表" className="divide-y divide-hairline">
					{links.data.map((link) => {
						const view = shareLinkView(link);
						return (
							<li key={link.token} className="flex flex-col gap-2 py-3">
								<div className="flex items-center justify-between gap-2">
									<span className="font-mono text-[13px]" title={link.token}>
										{view.shortToken}
									</span>
									<span className="text-[12px] text-muted">已用 {view.usageText}</span>
								</div>
								<div className="flex items-center justify-between gap-2">
									<span className={view.usable ? "text-[12px] text-muted" : "text-[12px] text-danger"}>
										{view.usable ? `${view.expiryText} · 可用` : view.stateText}
									</span>
									<span className="flex gap-2">
										<Button size="sm" disabled={!view.usable} onClick={() => copy(link)}>
											复制
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
