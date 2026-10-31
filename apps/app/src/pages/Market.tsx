import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	Bookmark,
	Briefcase,
	Check,
	Ellipsis,
	HandHelping,
	Heart,
	Lightbulb,
	Package,
	Plus,
	Search,
	SlidersHorizontal,
	Sparkles,
	X,
} from "lucide-react";
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { AppBar } from "../components/AppBar";
import { AgentBriefDialog, AgentWorkspace } from "../components/market/BuyerAgent";
import { ListingCard } from "../components/market/ListingCard";
import { CompareDialog, ListingDetail } from "../components/market/ListingDetail";
import { MarketStats } from "../components/market/MarketStats";
import { MarketDialog } from "../components/market/MarketUI";
import { PublishDialog, SellerWorkspace } from "../components/market/SellPanel";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { cn } from "../lib/cn";
import { entityRef } from "../lib/entityRef";
import { internalState, usePersonalMarketBack } from "../lib/navigation";
import { selectPersonalAgent, usePersonalAgent } from "../lib/personalAgent";
import { CHANNELS } from "../market/catalog";
import { defaultFilters, filterListings, type MarketFilters, priceError } from "../market/flows";
import { listingContext, needContext } from "../market/handoff";
import { findMatches, inferBrief, taskTitle } from "../market/matching";
import { useMarketState } from "../market/store";
import type { AgentTask, Listing, SearchBrief } from "../market/types";
import { toast } from "../ui/Toast";
import "../market/market.css";

type View = "discover" | "agent" | "selling" | "saved" | "liked" | "stats";
const PERSONAL = {
	needs: { view: "agent", label: "我的需求" },
	posts: { view: "selling", label: "我的发布" },
	saved: { view: "saved", label: "我的收藏" },
	liked: { view: "liked", label: "我的点赞" },
	stats: { view: "stats", label: "浏览数据" },
} as const;
const CHANNEL_ICONS = {
	item: Package,
	service: Sparkles,
	idea: Lightbulb,
	job: Briefcase,
	request: HandHelping,
	other: Ellipsis,
};
export function Market() {
	const backToMe = usePersonalMarketBack();
	const { state, setState, storageKey } = useMarketState();
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const listingsQuery = useQuery({ queryKey: ["market-listings"], queryFn: () => api.marketListings() });
	const listings = listingsQuery.data ?? [];
	const listingsReady = !listingsQuery.isPending && !listingsQuery.isError;
	const staleSaved = listingsReady ? state.saved.filter((id) => !listings.some((l) => l.id === id)) : [];
	const staleLiked = listingsReady ? state.liked.filter((id) => !listings.some((l) => l.id === id)) : [];
	const { agent, agents, me } = usePersonalAgent();
	const [handoff, setHandoff] = useState<string | null>(null);
	const [handingOff, setHandingOff] = useState(false);
	const sendToPA = async () => {
		if (!agent || !handoff?.trim() || handingOff) return;
		setHandingOff(true);
		try {
			const conversation = await api.openDm(agent.id);
			await qc.invalidateQueries({ queryKey: ["convs"] });
			navigate("/c/" + entityRef(conversation), {
				state: { ...internalState(location), marketDraft: { convId: conversation.id, text: handoff } },
			});
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法打开 Bot 对话，请重试", true);
		} finally {
			setHandingOff(false);
		}
	};
	const location = useLocation();
	const route = useParams();
	const personal = route.section ? PERSONAL[route.section as keyof typeof PERSONAL] : undefined;
	const channel = CHANNELS.find((c) => c.id === route.channel);
	const searching = location.pathname === "/market/search";
	const home = location.pathname === "/market";
	const view: View = personal?.view ?? "discover";
	const title = personal?.label ?? channel?.label ?? (searching ? "找一找" : "市场");
	const filters = useMemo(
		() => ({
			...defaultFilters,
			kind: channel?.kind ?? "全部",
			city: params.get("city") ?? "不限",
			min: params.get("min") ?? "",
			max: params.get("max") ?? "",
			sort: params.get("sort") ?? "综合排序",
		}),
		[params, channel],
	);
	const setFilters = (next: MarketFilters) => {
		const p = new URLSearchParams(params);
		Object.entries(next).forEach(([k, v]) => {
			if (k !== "kind" && k !== "category") p.set(k, v);
		});
		p.delete("panel");
		setParams(p, { replace: true });
	};
	const panel = params.get("panel");
	const pageRef = useRef<HTMLDivElement>(null);
	const scrolls = useRef<Record<string, number>>({});
	const [query, setQuery] = useState(params.get("q") ?? "");
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在地址栏查询变化时同步输入框，避免输入被覆盖
	useEffect(() => setQuery(params.get("q") ?? ""), [location.pathname, params.get("q")]);
	const [visibleCount, setVisibleCount] = useState(12);
	const [mineTab, setMineTab] = useState("published");
	const [refreshing, setRefreshing] = useState<string>();
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(refreshTimer.current), []);
	const scrollKey = `${location.pathname}:${params.get("q") ?? ""}:${view}:${params.get("task") ?? params.get("chat") ?? ""}:${view === "selling" ? mineTab : ""}`;
	useLayoutEffect(() => {
		document.title = `${title} · Yonder`;
		pageRef.current?.scrollTo({ top: scrolls.current[scrollKey] ?? 0 });
		return () => {
			document.title = "Yonder";
		};
	}, [scrollKey, title]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 筛选或路由变化即重置分页，hook 体只重置计数
	useEffect(() => setVisibleCount(12), [params.get("q"), location.pathname, filters]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 搜索只随查询词与列表变化，params 为地址快照
	const searchResults = useMemo(() => {
		const text = params.get("q") ?? "";
		const literal = filterListings(listings, text, defaultFilters);
		const brief = inferBrief(text);
		const related =
			literal.length === 0 && brief.category !== "不限"
				? findMatches(listings, brief).map((match) => match.listing)
				: [];
		return { listings: literal.length ? literal : related, related: related.length > 0 };
	}, [listings, params.get("q")]);
	const shown = useMemo(
		() =>
			view === "saved" || view === "liked"
				? state[view]
						.flatMap((id) => {
							const item = listings.find((l) => l.id === id);
							return item ? [item] : [];
						})
						.reverse()
				: filterListings(searching ? searchResults.listings : listings, "", home ? defaultFilters : filters),
		[state, listings, view, searching, searchResults, home, filters],
	);
	const activeTask = state.tasks.find((t) => t.id === params.get("task"));
	const matches = useMemo(() => (activeTask ? findMatches(listings, activeTask) : []), [listings, activeTask]);
	const detail = listings.find((l) => l.id === params.get("item")) ?? null;
	const editing = listings.find((l) => l.id === params.get("edit"));
	const comparison = state.compare.flatMap((id) => {
		const item = listings.find((l) => l.id === id);
		return item ? [item] : [];
	});
	const setView = (next: View) =>
		navigate(next === "discover" ? "/market" : "/me/market/" + (next === "agent" ? "needs" : "posts"));
	const openPanel = (name: string, extra: Record<string, string> = {}) => {
		const next = new URLSearchParams(params);
		next.set("panel", name);
		Object.entries(extra).forEach(([k, v]) => {
			next.set(k, v);
		});
		setParams(next, { state: { marketOverlay: true } });
	};
	const closePanel = () => {
		if (location.state?.marketOverlay) {
			navigate(-1);
			return;
		}
		const next = new URLSearchParams(params);
		["panel", "item", "edit"].forEach((k) => {
			next.delete(k);
		});
		setParams(next, { replace: true });
	};
	const openDetail = (l: Listing) => openPanel("detail", { item: l.id });
	const startChat = (l: Listing) => setHandoff(listingContext(l));
	const toggleLiked = (id: string) =>
		setState((s) => ({ ...s, liked: s.liked.includes(id) ? s.liked.filter((x) => x !== id) : [...s.liked, id] }));
	const toggleSaved = (id: string) =>
		setState((s) => ({ ...s, saved: s.saved.includes(id) ? s.saved.filter((x) => x !== id) : [...s.saved, id] }));
	const toggleCompare = (id: string) => {
		if (!state.compare.includes(id) && state.compare.length >= 3) {
			toast("最多对比 3 件，请先移除一件");
			return;
		}
		setState((s) => ({
			...s,
			compare: s.compare.includes(id) ? s.compare.filter((x) => x !== id) : [...s.compare, id],
		}));
	};
	const compareMany = (ids: string[]) => {
		setState((s) => ({ ...s, compare: ids.slice(0, 3) }));
		openPanel("compare");
	};
	const saveTask = (brief: SearchBrief, id?: string) => {
		const task: AgentTask = {
			...brief,
			id: id ?? crypto.randomUUID(),
			title: taskTitle(brief.text),
			active: true,
			checkedAt: Date.now(),
			seenIds: [],
		};
		setState((s) => ({ ...s, tasks: [task, ...s.tasks.filter((t) => t.id !== task.id)] }));
		navigate("/me/market/needs?task=" + task.id, { replace: true });
	};
	const saveListing = async (listing: Listing): Promise<boolean> => {
		if (listing.image.startsWith("data:")) {
			toast("草稿中的图片无法发布，请重新编辑草稿", true);
			return false;
		}
		const input = {
			category: listing.category,
			title: listing.title,
			description: listing.description,
			price: listing.price,
			unit: listing.unit,
			location: listing.location,
			delivery: listing.delivery,
			images: listing.image ? [listing.image] : [],
			sellerRole: listing.sellerRole,
			discoverable: listing.discoverable !== false,
			agent: listing.agent,
			tags: listing.tags,
			facts: listing.facts,
			missing: listing.missing,
		};
		try {
			if (editing) await api.updateListing(editing.id, input);
			else await api.createListing({ ...input, kind: listing.kind });
		} catch (error) {
			toast(error instanceof Error ? error.message : "发布失败，请重试", true);
			return false;
		}
		await qc.invalidateQueries({ queryKey: ["market-listings"] });
		setMineTab("published");
		navigate("/me/market/posts", { replace: true });
		toast(editing ? "修改已保存" : "已发布，可在「我 · 我的发布」管理");
		return true;
	};
	const refresh = (id: string) => {
		if (refreshing) return;
		setRefreshing(id);
		refreshTimer.current = setTimeout(() => {
			setState((s) => ({
				...s,
				tasks: s.tasks.map((t) =>
					t.id === id ? { ...t, checkedAt: Date.now(), seenIds: findMatches(listings, t).map((m) => m.listing.id) } : t,
				),
			}));
			setRefreshing(undefined);
			toast("已按最新条件重新筛选");
		}, 350);
	};
	const filterCount = [filters.city !== "不限", !!filters.min || !!filters.max].filter(Boolean).length;
	const submitSearch = (e: FormEvent) => {
		e.preventDefault();
		if (query.trim()) navigate("/market/search?q=" + encodeURIComponent(query.trim()));
	};
	const askPA = () =>
		setHandoff(
			"我想找：" +
				(params.get("q") || query || "还没有想清楚的东西或服务") +
				"。请先帮我厘清用途、预算和限制，再一起找合适的商品、服务或其他可能的解决方式。",
		);
	// Keep old shared links useful, but personal work now belongs under Me.
	if (home && params.get("view") === "agent")
		return <Navigate to={"/me/market/needs" + (params.get("task") ? "?task=" + params.get("task") : "")} replace />;
	if (home && params.get("view") === "selling") return <Navigate to="/me/market/posts" replace />;
	if ((route.channel && !channel) || (route.section && !personal))
		return <Navigate to={route.section ? "/me" : "/market"} replace />;
	const collection = view === "saved" || view === "liked";
	return (
		<div className="mk-app">
			<div
				className="mk-main"
				ref={pageRef}
				onScroll={(e) => {
					scrolls.current[scrollKey] = e.currentTarget.scrollTop;
				}}
			>
				<AppBar
					className="mk-market-header"
					headingClassName="mk-page-heading"
					title={title}
					left={
						home ? (
							<PersonalAvatar />
						) : personal ? (
							<button type="button" className="mk-icon-button" aria-label="返回我的" onClick={backToMe}>
								<ArrowLeft size={21} aria-hidden />
							</button>
						) : (
							<Link className="mk-icon-button" to="/market" aria-label="返回市场">
								<ArrowLeft size={21} aria-hidden />
							</Link>
						)
					}
					right={
						(home || channel || view === "selling") && (
							<button
								type="button"
								className="mk-button mk-primary mk-publish-action"
								onClick={() => openPanel("publish")}
							>
								<Plus size={18} aria-hidden />
								发布
							</button>
						)
					}
				/>
				<main className={cn("mk-content", view === "discover" && "mk-discover")}>
					{view === "discover" && (
						<>
							<form className="mk-search mk-unified-search" onSubmit={submitSearch}>
								<Sparkles size={20} aria-hidden="true" />
								<input
									name="search"
									aria-label="告诉 Bot 你想找什么"
									placeholder="说说你的想法，Bot 帮你找"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
								/>
								{query && (
									<button type="button" className="mk-icon-button" aria-label="清空输入" onClick={() => setQuery("")}>
										<X size={17} />
									</button>
								)}
								<button type="submit" className="mk-search-submit" aria-label="搜索并梳理想法" disabled={!query.trim()}>
									<ArrowRight size={19} />
								</button>
							</form>
							<p className="mk-search-hint">具体的商品，或一个还模糊的想法，都可以。</p>
							{home && (
								<nav className="mk-channel-row" aria-label="市场分类">
									{CHANNELS.map((c) => {
										const Icon = CHANNEL_ICONS[c.kind];
										return (
											<Link key={c.id} to={"/market/category/" + c.id}>
												<span>
													<Icon size={22} strokeWidth={1.6} />
												</span>
												{c.label}
											</Link>
										);
									})}
								</nav>
							)}
							{searching && (
								<section className="mk-search-assist">
									<div>
										<Sparkles size={20} />
										<div>
											<strong>和 Bot 一起，把想法变成选择</strong>
											<p>可以先聊用途和偏好，不必知道商品叫什么。</p>
										</div>
									</div>
									<div className="mk-search-actions">
										<button type="button" className="mk-button mk-primary" onClick={askPA}>
											继续和 Bot 聊<ArrowRight size={16} />
										</button>
										<button type="button" className="mk-button" onClick={() => openPanel("brief")}>
											保存为需求
										</button>
									</div>
								</section>
							)}
							{!home && (
								<div className="mk-browse-controls">
									<span className="mk-muted">
										{searching ? (searchResults.related ? "相关线索 · 本机条件匹配" : "搜索结果") : channel?.label} ·{" "}
										{shown.length}
									</span>
									<div className="mk-feed-tools">
										<label>
											<span className="sr-only">排序方式</span>
											<select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
												{["综合排序", "最新", "价格从低到高", "价格从高到低"].map((s) => (
													<option key={s} value={s}>
														{s === "综合排序"
															? "综合"
															: s === "价格从低到高"
																? "价格 ↑"
																: s === "价格从高到低"
																	? "价格 ↓"
																	: s}
													</option>
												))}
											</select>
										</label>
										<button
											type="button"
											className={cn("mk-filter-trigger", filterCount > 0 && "is-active")}
											onClick={() => openPanel("filters")}
										>
											<SlidersHorizontal size={17} />
											筛选{filterCount > 0 && <span>{filterCount}</span>}
										</button>
									</div>
								</div>
							)}
							{!home && filterCount > 0 && (
								<div className="mk-filter-summary">
									<span>
										{filters.city !== "不限" && filters.city}
										{(filters.min || filters.max) && " · ¥" + (filters.min || "0") + "–" + (filters.max || "不限")}
									</span>
									<button type="button" onClick={() => setFilters(defaultFilters)}>
										清除筛选
										<X size={14} />
									</button>
								</div>
							)}
						</>
					)}
					{(view === "discover" || collection) && (
						<>
							{listingsQuery.isPending && (
								<div className="mk-feed-grid" aria-busy="true">
									<span className="sr-only">正在加载市场</span>
									{["a", "b", "c", "d", "e", "f"].map((slot) => (
										<div key={slot} className="mk-skeleton-card" />
									))}
								</div>
							)}
							{listingsQuery.isError && (
								<div className="mk-empty" role="alert">
									<X size={30} />
									<h3>加载失败</h3>
									<p>没能连上市场服务，请检查网络后重试。</p>
									<button type="button" className="mk-button mk-primary" onClick={() => void listingsQuery.refetch()}>
										重试
									</button>
								</div>
							)}
							{collection && listingsReady && (view === "saved" ? staleSaved : staleLiked).length > 0 && (
								<p className="mk-form-hint">
									有 {(view === "saved" ? staleSaved : staleLiked).length} 条{view === "saved" ? "收藏" : "点赞"}
									已失效（帖子已下架或删除），已从列表隐藏。
								</p>
							)}
							{listingsReady && (
								<>
									<div className="mk-feed-grid">
										{shown.slice(0, visibleCount).map((l) => (
											<ListingCard
												key={l.id}
												listing={l}
												saved={state.saved.includes(l.id)}
												liked={state.liked.includes(l.id)}
												onOpen={() => openDetail(l)}
												onSave={() => toggleSaved(l.id)}
												onLike={() => toggleLiked(l.id)}
											/>
										))}
									</div>
									{!shown.length && (
										<div className="mk-empty">
											{collection ? (
												view === "saved" ? (
													<Bookmark size={30} />
												) : (
													<Heart size={30} />
												)
											) : (
												<Search size={30} />
											)}
											<h3>
												{collection
													? view === "saved"
														? "还没有收藏"
														: "还没有点赞"
													: listings.length === 0 && !searching
														? "市场还没有帖子"
														: "暂时没有找到"}
											</h3>
											<p>
												{collection
													? "逛到喜欢的帖子，随时留下来。"
													: searching
														? "换个关键词，或让 Bot 帮你把想法聊清楚。"
														: "这里还没有帖子，发布第一篇吧。"}
											</p>
											{collection && (
												<Link className="mk-button" to="/market">
													去市场逛逛
													<ArrowRight size={16} />
												</Link>
											)}
											{view === "discover" && !searching && listings.length === 0 && (
												<button type="button" className="mk-button mk-primary" onClick={() => openPanel("publish")}>
													<Plus size={16} />
													发布第一条
												</button>
											)}
										</div>
									)}
									{shown.length > visibleCount ? (
										<button type="button" className="mk-load-more" onClick={() => setVisibleCount((n) => n + 12)}>
											继续逛
											<ArrowDown size={16} />
										</button>
									) : (
										shown.length > 0 && (
											<p className="mk-feed-end">
												已经看到这里了<span>示例内容与浏览数据</span>
											</p>
										)
									)}
								</>
							)}
						</>
					)}
					{view === "stats" && <MarketStats listings={listings} onStats={(l) => openPanel("stats", { item: l.id })} />}
					{view === "agent" && (
						<AgentWorkspace
							tasks={state.tasks}
							onDelegate={(task) => setHandoff(needContext(task))}
							listings={listings}
							selectedId={activeTask?.id}
							onSelect={(id) => setParams({ task: id })}
							onBack={() => setParams({})}
							onNew={() => openPanel("brief")}
							onEdit={() => openPanel("brief")}
							onToggle={(id) =>
								setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, active: !t.active } : t)) }))
							}
							onRefresh={refresh}
							refreshing={refreshing}
							onOpen={openDetail}
							onCompare={compareMany}
						/>
					)}
					{view === "selling" && (
						<SellerWorkspace
							listings={listings}
							saved={state.saved}
							tab={mineTab}
							onTab={setMineTab}
							onEdit={(l) => openPanel("publish", { edit: l.id })}
							onToggle={(id) => {
								const item = listings.find((l) => l.id === id);
								if (!item) return;
								api
									.setListingPaused(id, !item.paused)
									.then(() => qc.invalidateQueries({ queryKey: ["market-listings"] }))
									.catch((error) => toast(error instanceof Error ? error.message : "操作失败，请重试", true));
							}}
							onOpen={openDetail}
							onSave={toggleSaved}
							onStats={(l) => openPanel("stats", { item: l.id })}
							onBrowse={() => setView("discover")}
						/>
					)}
				</main>
			</div>
			{comparison.length > 0 && !panel && (view === "discover" || collection) && (
				<aside className="mk-compare-dock" aria-label="对比清单">
					<div className="mk-dock-photos">
						{comparison.map((l) => (
							<button type="button" key={l.id} aria-label={`移除${l.title}`} onClick={() => toggleCompare(l.id)}>
								<img src={l.image} alt="" />
								<X size={12} />
							</button>
						))}
					</div>
					<button
						type="button"
						className="mk-button mk-primary"
						disabled={comparison.length < 2}
						onClick={() => openPanel("compare")}
					>
						{comparison.length < 2 ? "再选一件" : `对比 ${comparison.length} 件`}
						<ArrowRight size={15} />
					</button>
					<button
						type="button"
						className="mk-icon-button"
						aria-label="清空对比"
						onClick={() => setState((s) => ({ ...s, compare: [] }))}
					>
						<X size={18} />
					</button>
				</aside>
			)}
			<AgentBriefDialog
				open={panel === "brief"}
				close={closePanel}
				editingTask={activeTask}
				initialText={query}
				storageKey={storageKey}
				onSave={saveTask}
			/>
			<PublishDialog
				open={panel === "publish"}
				close={closePanel}
				editing={editing}
				storageKey={storageKey}
				onPublish={saveListing}
			/>
			<ListingDetail
				listing={panel === "detail" ? detail : null}
				match={matches.find((m) => m.listing.id === detail?.id)}
				liked={!!detail && state.liked.includes(detail.id)}
				onLike={() => detail && toggleLiked(detail.id)}
				saved={!!detail && state.saved.includes(detail.id)}
				compared={!!detail && state.compare.includes(detail.id)}
				close={closePanel}
				onSave={() => detail && toggleSaved(detail.id)}
				onCompare={() => detail && toggleCompare(detail.id)}
				onInquiry={startChat}
				onEdit={(l) => {
					const next = new URLSearchParams(params);
					next.delete("item");
					next.set("edit", l.id);
					next.set("panel", "publish");
					setParams(next, { replace: true, state: location.state });
				}}
			/>
			{panel === "compare" && (
				<CompareDialog
					listings={comparison}
					matches={matches}
					close={closePanel}
					onRemove={toggleCompare}
					onInquiry={startChat}
				/>
			)}
			{panel === "filters" && <FilterDialog filters={filters} close={closePanel} onApply={(f) => setFilters(f)} />}
			<MarketDialog open={panel === "stats"} close={closePanel} title="发布表现">
				{detail && (
					<div className="mk-dialog-body">
						<h3>{detail.title}</h3>
						<p className="mk-muted">{detail.metricSource === "sample" ? "示例统计 · 非实时数据" : "当前记录"}</p>
						<div className="mk-stats-grid">
							{[
								{ label: "Bot 浏览", value: detail.metrics.agentViews },
								{ label: "加入候选", value: detail.metrics.shortlists },
								{ label: "用户浏览", value: detail.metrics.humanViews },
								{ label: "收到咨询", value: detail.metrics.inquiries },
							].map((m) => (
								<div key={m.label}>
									<strong>{m.value.toLocaleString()}</strong>
									<span>{m.label}</span>
								</div>
							))}
						</div>
						<p className="mk-form-hint">Bot 浏览与真人浏览分别统计。连接真实市场后，这里会展示新增曝光与咨询。</p>
					</div>
				)}
			</MarketDialog>
			<MarketDialog open={handoff !== null} close={() => !handingOff && setHandoff(null)} title="交给我的 Bot">
				<div className="mk-dialog-body">
					<div className="mk-handoff-agent">
						<Sparkles size={21} />
						<div>
							<strong>{agent?.name ?? "尚未选择 Bot"}</strong>
							<p className="mk-muted">{agent?.online ? "已连接" : "离线，发送的消息会保留"}</p>
						</div>
						<select
							aria-label="选择处理此需求的 Bot"
							value={agent?.id ?? ""}
							onChange={(e) => {
								if (me) {
									try {
										selectPersonalAgent(me.id, e.target.value);
									} catch {
										toast("无法保存 Bot 选择", true);
									}
								}
							}}
						>
							{agents.map((a) => (
								<option key={a.id} value={a.id}>
									{a.name}
								</option>
							))}
						</select>
					</div>
					<label className="mk-form-label">
						带入对话的内容
						<textarea rows={9} maxLength={20000} value={handoff ?? ""} onChange={(e) => setHandoff(e.target.value)} />
					</label>
					<p className="mk-form-hint">将回到你的 Bot 对话，确认后发送。不会自动联系卖家或执行交易。</p>
					<div className="mk-form-actions">
						<button type="button" className="mk-button" disabled={handingOff} onClick={() => setHandoff(null)}>
							取消
						</button>
						<button
							type="button"
							className="mk-button mk-primary"
							disabled={!agent || !handoff?.trim() || handingOff}
							onClick={() => void sendToPA()}
						>
							{handingOff ? "打开中…" : "带入 Bot 对话"}
							<ArrowRight size={16} />
						</button>
					</div>
				</div>
			</MarketDialog>
		</div>
	);
}
function FilterDialog({
	filters,
	close,
	onApply,
}: {
	filters: MarketFilters;
	close: () => void;
	onApply: (f: MarketFilters) => void;
}) {
	const [draft, setDraft] = useState(filters);
	const error = priceError(draft.min, draft.max);
	return (
		<MarketDialog open close={close} title="筛选">
			<form
				className="mk-dialog-body"
				onSubmit={(e) => {
					e.preventDefault();
					if (!error) onApply(draft);
				}}
			>
				<label className="mk-form-label">
					所在城市
					<select value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })}>
						{["不限", "上海", "杭州", "苏州", "南京", "北京", "深圳", "广州", "成都", "线上"].map((c) => (
							<option key={c}>{c}</option>
						))}
					</select>
				</label>
				<fieldset className="mk-form-label">
					<legend>价格范围（元）</legend>
					<div className="mk-form-grid">
						<input
							aria-label="最低价格"
							inputMode="decimal"
							type="number"
							min="0"
							placeholder="最低价"
							value={draft.min}
							onChange={(e) => setDraft({ ...draft, min: e.target.value })}
						/>
						<input
							aria-label="最高价格"
							inputMode="decimal"
							type="number"
							min="0"
							placeholder="最高价"
							value={draft.max}
							onChange={(e) => setDraft({ ...draft, max: e.target.value })}
						/>
					</div>
				</fieldset>
				{error && (
					<p role="alert" className="mk-error">
						{error}
					</p>
				)}
				<div className="mk-form-actions">
					<button
						type="button"
						className="mk-button"
						onClick={() => setDraft({ ...draft, min: "", max: "", city: "不限" })}
					>
						重置
					</button>
					<button type="button" className="mk-button mk-primary" disabled={!!error}>
						应用筛选
						<Check size={16} />
					</button>
				</div>
			</form>
		</MarketDialog>
	);
}
