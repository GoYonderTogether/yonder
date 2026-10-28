import { LogOut } from "lucide-react";
import { useFacts } from "../lib/queries";

/** 「我」/ 头像进入的个人页与设置：节点信息 + 退出。 */
export function Settings({ onLogout }: { onLogout(): void }) {
	const f = useFacts();
	const d = f.data;
	const rows: [string, string][] = d
		? [
				["版本", `${d.version.yonder}${d.version.commit ? ` (${d.version.commit.slice(0, 7)})` : ""}`],
				["连接方式", d.kind === "local" ? "本机" : "远程"],
				["权限", d.granted.join(" / ")],
				["协议版本", String(d.protocol)],
				["可用方法", `${Object.keys(d.methods).length} 个`],
			]
		: [];
	return (
		<div className="scroll-y h-full">
			<h1 className="pt-safe px-4 pt-3 pb-1 text-title font-semibold">我</h1>
			<section className="mx-4 mt-2 rounded-card bg-raised p-4 text-small" data-testid="settings">
				<p>已登录 · {d?.kind === "local" ? "本机票据" : "远程访问令牌"}</p>
				<p className="mt-1 text-faint">会话置顶、免打扰和已读位置只保存在这台设备的浏览器里。</p>
			</section>
			<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="device-card">
				<h2 className="mb-2 flex items-center gap-2 text-body font-medium">
					<span className="size-2 rounded-full bg-online" aria-hidden />
					当前节点
				</h2>
				{f.isLoading && <p className="text-small text-faint">加载中…</p>}
				{f.isError && <p className="text-small text-danger">{f.error.message}</p>}
				<dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-small">
					{rows.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="min-w-0 break-words">{v}</dd>
						</div>
					))}
				</dl>
				<p className="mt-3 text-caption text-faint">多设备节点列表要等网关提供 nodes 接口后显示。</p>
			</section>
			<button
				type="button"
				onClick={onLogout}
				className="press mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-card bg-raised py-3 text-body text-danger"
			>
				<LogOut size={17} aria-hidden /> 退出登录
			</button>
		</div>
	);
}
