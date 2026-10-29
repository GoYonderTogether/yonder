import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { rpc } from "../../api/client";
import { toast } from "../../ui/kit/Toast";

export interface ChannelRow {
	instance: string;
	type?: string;
	login: boolean;
}
interface LoginResult {
	status: string;
	instance: string;
	qrcodeUrl?: string;
	expiresAt?: string;
	peer?: string;
}

/** 渠道分区：channels.list 的实例与状态；可登录的实例调用 channels.login 展示二维码链接。 */
export function ChannelsSection() {
	const list = useQuery({
		queryKey: ["channels-list"],
		queryFn: () => rpc<ChannelRow[]>("channels.list", {}),
		retry: false,
	});
	const [busy, setBusy] = useState<string>();
	const [results, setResults] = useState<Record<string, LoginResult>>({});
	const login = async (instance: string) => {
		setBusy(instance);
		try {
			const result = await rpc<LoginResult>("channels.login", { instance, action: "start" });
			setResults((current) => ({ ...current, [instance]: result }));
		} catch (error) {
			toast(error instanceof Error ? error.message : "渠道登录失败", true);
		} finally {
			setBusy(undefined);
		}
	};
	const safeLink = (url?: string) => {
		try {
			const parsed = url ? new URL(url) : undefined;
			return parsed?.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href : undefined;
		} catch {
			return undefined;
		}
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-channels">
			<h2 className="mb-2 text-body font-medium">渠道</h2>
			{list.isLoading && <p className="text-small text-faint">加载中…</p>}
			{list.isError && <p className="text-small text-danger">{list.error.message}</p>}
			<ul className="flex flex-col gap-1">
				{list.data?.map((row) => {
					const result = results[row.instance];
					const link = safeLink(result?.qrcodeUrl);
					return (
						<li key={row.instance} className="rounded-control py-1.5" data-testid={`channel-${row.instance}`}>
							<div className="flex items-center gap-2">
								<span className="min-w-0 flex-1">
									<span className="block truncate text-small">{row.instance}</span>
									<span className="block truncate text-caption text-faint">
										{row.type ?? "内置"} · {row.login ? "支持扫码登录" : "无需登录"}
									</span>
								</span>
								{row.login && (
									<button
										type="button"
										disabled={busy === row.instance}
										onClick={() => login(row.instance)}
										className="press rounded-control bg-tone px-3 py-1.5 text-small"
									>
										{busy === row.instance ? "获取中…" : "扫码登录"}
									</button>
								)}
							</div>
							{result && (
								<p className="mt-1 break-all text-caption text-faint">
									状态：{result.status}
									{link ? (
										<>
											{" · "}
											<a href={link} target="_blank" rel="noreferrer" className="text-accent underline">
												打开二维码链接
											</a>
										</>
									) : result.qrcodeUrl ? (
										<> · 二维码链接不是 HTTPS，已隐藏</>
									) : null}
									{result.expiresAt ? ` · 过期 ${result.expiresAt}` : ""}
								</p>
							)}
						</li>
					);
				})}
			</ul>
			{list.data?.length === 0 && <p className="text-small text-faint">尚未配置渠道实例</p>}
		</section>
	);
}
