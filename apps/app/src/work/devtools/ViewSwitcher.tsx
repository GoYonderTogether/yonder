import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Monitor, Smartphone, Tablet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { logout as gatewayLogout } from "../api/client";
import { qk } from "../api/keys";
import { setActiveNode, useActiveNode, useNodes } from "../api/nodes";
import { httpApi } from "../api/social";
import { mux } from "../api/stream";
import { cn } from "../lib/cn";
import { href } from "../shell/routes";
import { applyStateOverride } from "./stateOverride";
import {
	groupInviteHash,
	presetBreakpoint,
	previewUrl,
	publicCardHash,
	ROUTE_JUMPS,
	STATE_MODES,
	type StateMode,
	storeDevtoolsEnabled,
	stripDevtoolsParam,
	THEME_CHOICES,
	type ThemeChoice,
	themeAttribute,
	VIEWPORT_PRESETS,
	type ViewportId,
	viewportOf,
} from "./viewState";
import "./devtools.css";

/**
 * 开发/演示用视图切换浮窗。只在 ?devtools=1 或 localStorage 开启时由 main.tsx 懒加载；
 * 所有数据仍来自真实网关——这里只切换界面状态、断点、身份入口、节点与路由，不造假数据。
 */
export function ViewSwitcher({ onDisable }: { onDisable(): void }) {
	const qc = useQueryClient();
	const [open, setOpen] = useState(true);
	const [theme, setTheme] = useState<ThemeChoice>("system");
	const [stateMode, setStateMode] = useState<StateMode>("none");
	const [viewport, setViewport] = useState<ViewportId | null>(null);
	const [previewKey, setPreviewKey] = useState(0);
	const [cardId, setCardId] = useState("");
	const [groupToken, setGroupToken] = useState("");
	const [socialError, setSocialError] = useState("");

	const nodes = useNodes();
	const active = useActiveNode();
	const social = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session, retry: false });
	const socialLabel = social.isPending
		? "读取中…"
		: social.isError
			? "读取失败"
			: social.data === null
				? "未登录"
				: social.data?.actor.anonymous
					? "匿名访客"
					: "正式账号";

	// 状态模拟：直接改真实缓存里各查询的状态，页面用自己的分支渲染；退出时恢复原状态。
	const [covered, setCovered] = useState(0);
	useEffect(() => {
		const handle = applyStateOverride(qc, stateMode);
		setCovered(handle.count());
		return () => handle.stop();
	}, [qc, stateMode]);
	useEffect(() => {
		const value = themeAttribute(theme);
		if (value) document.documentElement.dataset.devtoolsTheme = value;
		else delete document.documentElement.dataset.devtoolsTheme;
	}, [theme]);
	useEffect(
		() => () => {
			delete document.documentElement.dataset.devtoolsTheme;
		},
		[],
	);

	const disable = () => {
		storeDevtoolsEnabled(false);
		history.replaceState(history.state, "", stripDevtoolsParam(location.href));
		onDisable();
	};

	const go = (hash: string | undefined) => {
		if (hash) location.hash = hash;
	};

	const logoutGateway = async () => {
		mux.reset();
		try {
			await gatewayLogout();
		} finally {
			// 重新加载后同一 URL（含 ?devtools=1）仍然生效；cookie 已清，App 会落到登录页。
			location.reload();
		}
	};

	/** 身份切换都走真实接口；失败原因原样显示，不冒充成功。 */
	const socialAction = async (action: () => Promise<void>) => {
		setSocialError("");
		try {
			await action();
			// 换身份后联系人与资料属于另一个账号，重新问网关，不沿用上一个身份的缓存。
			await Promise.all(
				["contacts", "convs", "cards", "profile", "resolve", "social"].map((key) =>
					qc.invalidateQueries({ queryKey: [key] }),
				),
			);
		} catch (error) {
			setSocialError(error instanceof Error ? error.message : "操作失败");
		}
	};
	const socialGuest = () =>
		socialAction(async () => {
			await httpApi.logout();
			qc.setQueryData(qk.socialSession, null);
		});
	const socialAnonymous = () =>
		socialAction(async () => {
			const session = await httpApi.createAnonymous();
			qc.setQueryData(qk.socialSession, session);
		});

	const preset = viewport ? viewportOf(viewport) : undefined;

	return (
		<>
			{viewport && preset && (
				<div className="fixed inset-0 z-[65] flex flex-col bg-ink/40 backdrop-blur-sm" data-testid="viewport-preview">
					<header className="flex shrink-0 items-center gap-2 bg-raised px-4 py-2 text-small shadow-soft">
						<span className="font-medium">
							{preset.label} · {preset.width}×{preset.height} · {presetBreakpoint(viewport)}
						</span>
						<span className="min-w-0 flex-1 truncate text-caption text-faint">
							iframe 内是完整应用（真实数据），断点按 iframe 的 window.innerWidth 计算。
						</span>
						<button
							type="button"
							onClick={() => setPreviewKey((n) => n + 1)}
							className="press rounded-full bg-tone px-3 py-1 text-caption"
						>
							刷新
						</button>
						<button
							type="button"
							onClick={() => setViewport(null)}
							aria-label="关闭断点预览"
							className="press grid size-8 place-items-center rounded-full hover:bg-tone"
						>
							<X size={16} />
						</button>
					</header>
					<div className="min-h-0 flex-1 overflow-auto p-4">
						<div className="mx-auto w-fit rounded-[28px] bg-ink/80 p-2 shadow-float">
							<iframe
								key={`${viewport}-${previewKey}`}
								title={`${preset.label}预览`}
								src={previewUrl(location.href)}
								width={preset.width}
								height={preset.height}
								className="rounded-[20px] border-0 bg-ground"
							/>
						</div>
						<p className="mx-auto mt-3 max-w-2xl text-center text-caption text-faint">
							网关直出的页面带 X-Frame-Options: DENY / frame-ancestors 'none'，浏览器会拒绝内嵌；断点验收请用 Vite
							开发页（npm run dev -w @yonder/app）。
						</p>
					</div>
				</div>
			)}

			{open ? (
				<aside
					aria-label="开发用视图切换"
					data-testid="devtools"
					className="fixed top-3 right-3 z-[70] flex max-h-[calc(100dvh-1.5rem)] w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-card border border-hairline bg-raised text-small shadow-float"
				>
					<header className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
						<Bug size={15} aria-hidden />
						<h2 className="flex-1 text-[13px] font-medium">视图切换 · 开发</h2>
						<button
							type="button"
							aria-label="收起"
							onClick={() => setOpen(false)}
							className="press grid size-6 place-items-center rounded-full text-muted hover:bg-tone"
						>
							<X size={14} />
						</button>
					</header>
					<div className="scroll-y min-h-0 flex-1 px-3 py-2">
						<p className="mb-2 text-caption text-faint">只切换界面状态；数据全部来自真实网关。</p>

						<Section title="断点">
							<div className="flex gap-1">
								{VIEWPORT_PRESETS.map((item) => {
									const Icon = item.id === "phone" ? Smartphone : item.id === "tablet" ? Tablet : Monitor;
									return (
										<button
											key={item.id}
											type="button"
											aria-pressed={viewport === item.id}
											onClick={() => {
												setPreviewKey((n) => n + 1);
												setViewport(item.id);
											}}
											className={btn(viewport === item.id)}
											title={`${item.width}×${item.height}（${presetBreakpoint(item.id)}）`}
										>
											<Icon size={13} aria-hidden /> {item.label}
										</button>
									);
								})}
							</div>
							<p className="mt-1 text-caption text-faint">
								在 iframe 里开完整应用；容器模拟无法改变 innerWidth，故未采用。
							</p>
						</Section>

						<Section title="路由">
							<div className="flex flex-wrap gap-1">
								{ROUTE_JUMPS.map((jump) => (
									<button key={jump.key} type="button" onClick={() => go(jump.hash)} className={btn(false)}>
										{jump.label}
									</button>
								))}
							</div>
							<div className="mt-1.5 flex gap-1">
								<input
									value={cardId}
									onChange={(e) => setCardId(e.target.value)}
									placeholder="名片 id（#/u/:id）"
									aria-label="名片 id"
									className="min-w-0 flex-1 rounded-control bg-tone px-2 py-1 text-caption outline-none"
								/>
								<button
									type="button"
									disabled={!cardId.trim()}
									onClick={() => go(publicCardHash(cardId))}
									className={btn(false)}
								>
									名片
								</button>
							</div>
							<div className="mt-1.5 flex gap-1">
								<input
									value={groupToken}
									onChange={(e) => setGroupToken(e.target.value)}
									placeholder="群邀请 token（#/g/:token）"
									aria-label="群邀请 token"
									className="min-w-0 flex-1 rounded-control bg-tone px-2 py-1 text-caption outline-none"
								/>
								<button
									type="button"
									disabled={!groupToken.trim()}
									onClick={() => go(groupInviteHash(groupToken))}
									className={btn(false)}
								>
									群邀请
								</button>
							</div>
						</Section>

						<Section title={`身份 · 社交 ${socialLabel}`}>
							<div className="flex flex-wrap gap-1">
								<button type="button" onClick={() => void socialGuest()} className={btn(false)}>
									未登录
								</button>
								<button type="button" onClick={() => void socialAnonymous()} className={btn(false)}>
									匿名访客（真实创建）
								</button>
								<button
									type="button"
									onClick={() => {
										setSocialError("");
										go(href({ tab: "me" }));
									}}
									className={btn(false)}
									title="正式账号要真实登录凭据，不做模拟登录"
								>
									正式账号 · 去登录
								</button>
							</div>
							{socialError && (
								<p role="alert" className="mt-1 text-caption text-danger">
									{socialError}
								</p>
							)}
							<p className="mt-1 text-caption text-faint">
								网关登录态：
								<button type="button" onClick={() => void logoutGateway()} className="underline">
									退出网关并重新加载
								</button>
							</p>
						</Section>

						<Section title={`节点 · ${active.name || active.id}`}>
							<div className="flex flex-col gap-1">
								{nodes.map((node) => (
									<div key={node.id} className="flex items-center gap-1">
										<button
											type="button"
											aria-pressed={node.id === active.id}
											onClick={() => setActiveNode(node.id)}
											className={cn(btn(node.id === active.id), "min-w-0 flex-1 truncate text-left")}
											title={node.origin ?? "同源（当前页面）"}
										>
											{node.name || node.id}
										</button>
										{node.origin && (
											<a
												href={node.origin}
												target="_blank"
												rel="noreferrer"
												className="shrink-0 rounded-full bg-tone px-2 py-1 text-caption hover:bg-tone-2"
												title={`在新标签打开 ${node.origin}`}
											>
												打开
											</a>
										)}
									</div>
								))}
							</div>
							<p className="mt-1 text-caption text-faint">
								切换只改「当前节点」标记与设置页显示；当前页面的数据仍取同源网关，远程节点要在它自己的页面打开。
							</p>
						</Section>

						<Section title="主题">
							<div className="flex gap-1">
								{THEME_CHOICES.map((choice) => (
									<button
										key={choice.id}
										type="button"
										aria-pressed={theme === choice.id}
										onClick={() => setTheme(choice.id)}
										className={btn(theme === choice.id)}
									>
										{choice.label}
									</button>
								))}
							</div>
							<p className="mt-1 text-caption text-faint">
								现有样式只有 prefers-color-scheme；这里是叠同一套 token 的预览。
							</p>
						</Section>

						<Section title="状态模拟">
							<div className="flex flex-wrap gap-1">
								{STATE_MODES.map((mode) => (
									<button
										key={mode.id}
										type="button"
										aria-pressed={stateMode === mode.id}
										onClick={() => setStateMode(mode.id)}
										className={btn(stateMode === mode.id)}
									>
										{mode.label}
									</button>
								))}
							</div>
							<p className="mt-1 text-caption text-faint">
								直接改真实查询缓存的状态（pending / 带标记的错误 / 空数组），页面用自己的分支渲染；
								数组以外的查询跳过，不编造结构。已覆盖 {covered} 个查询；切回「无」立即恢复。
							</p>
						</Section>
					</div>
					<footer className="flex shrink-0 items-center justify-between border-t border-hairline px-3 py-1.5 text-caption text-faint">
						<span>?devtools=1 或 localStorage</span>
						<button type="button" onClick={disable} className="press rounded-full px-2 py-1 hover:bg-tone">
							停用
						</button>
					</footer>
				</aside>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					aria-label="展开开发工具"
					data-testid="devtools-pill"
					className="press fixed top-3 right-3 z-[70] rounded-full bg-raised px-3 py-1.5 text-caption shadow-float"
				>
					开发
				</button>
			)}
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="mb-3">
			<h3 className="mb-1 text-caption font-medium text-muted">{title}</h3>
			{children}
		</section>
	);
}

const btn = (on: boolean) =>
	cn("press rounded-full px-2 py-1 text-caption", on ? "bg-accent text-on-accent" : "bg-tone text-ink hover:bg-tone-2");
