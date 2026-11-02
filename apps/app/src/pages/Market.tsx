import { useStore } from "@nanostores/react";
import { useQueryClient } from "@tanstack/react-query";
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
import { defaultFilters, type MarketFilters, priceError } from "../market/flows";
import { listingContext, needContext } from "../market/handoff";
import { listingInput, marketError } from "../market/listingPolicy";
import { editOf, inputOf, matchesOf, taskOf } from "../market/needs";
import { listingFilters, useListingFeed, useListingLookup, useMarketCapabilities } from "../market/queries";
import { useMarketState } from "../market/store";
import type { AgentTask, Listing, SearchBrief } from "../market/types";
import { migrateLegacyNeeds, needError, useNeedMatches, useWatchTasks, WATCH_TASKS_KEY } from "../market/watch";
import { $session } from "../store";
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
	const marketSupport = useMarketCapabilities();
	const { agent, agents, me } = usePersonalAgent();
	const session = useStore($session);
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
	const ownFeed = view === "selling" || view === "stats";
	const collectionView = view === "saved" || view === "liked";
	const listingsQuery = useListingFeed(
		ownFeed
			? { mine: true }
			: listingFilters(searching ? (params.get("q") ?? "") : "", home ? defaultFilters : filters),
		!collectionView,
	);
	const lookup = useListingLookup([
		...state.saved,
		...state.liked,
		...state.compare,
		...[params.get("item"), params.get("edit")].filter((id): id is string => !!id),
	]);
	const listings = listingsQuery.items;
	const referenced = [...lookup.items, ...listings];
	const listingsReady = collectionView
		? !lookup.isPending && !lookup.isError
		: !listingsQuery.isPending && !listingsQuery.isError;
	const staleSaved = state.saved.filter((id) => lookup.missing.includes(id));
	const staleLiked = state.liked.filter((id) => lookup.missing.includes(id));
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
	const [savingNeed, setSavingNeed] = useState<string>();
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
	const shown =
		view === "saved" || view === "liked"
			? state[view]
					.flatMap((id) => {
						const item = referenced.find((listing) => listing.id === id);
						return item ? [item] : [];
					})
					.reverse()
			: listings.filter((listing) => !listing.paused && (filters.kind !== "other" || listing.kind === "other"));

	// 我的需求只来自云端 watch_tasks；旧 localStorage 里的副本先迁移，成功后才删除本机那份。
	const canMigrate = !!session && !session.actor.anonymous;
	const watch = useWatchTasks(canMigrate);
	const cloudTasks = useMemo(() => (canMigrate ? (watch.data ?? []) : []), [canMigrate, watch.data]);
	const needTasks = useMemo(() => cloudTasks.map(taskOf), [cloudTasks]);
	const matches = useNeedMatches(cloudTasks);
	useEffect(() => {
		if (!canMigrate) return;
		let live = true;
		void migrateLegacyNeeds(storageKey).then((result) => {
			if (!live) return;
			if (result.created) {
				toast(`已把 ${result.created} 条需求存到云端，换设备也能看到`);
				void qc.invalidateQueries({ queryKey: [...WATCH_TASKS_KEY] });
			}
			if (result.error) toast(`还有 ${result.remaining} 条需求未能存到云端：${needError(result.error)}`, true);
		});
		return () => {
			live = false;
		};
	}, [canMigrate, storageKey, qc]);
	const activeTask = needTasks.find((t) => t.id === params.get("task"));
	const activeMatches = activeTask ? matchesOf(matches[activeTask.id]?.items ?? [], activeTask) : [];
	const detail = referenced.find((l) => l.id === params.get("item")) ?? null;
	const editing = referenced.find((l) => l.id === params.get("edit"));
	useEffect(() => {
		if (panel !== "assist" || !detail) return;
		setHandoff(listingContext(detail));
		const next = new URLSearchParams(params);
		next.delete("panel");
		next.delete("item");
		setParams(next, { replace: true, state: location.state });
	}, [panel, detail, params, setParams, location.state]);
	const comparison = state.compare.flatMap((id) => {
		const item = referenced.find((l) => l.id === id);
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
	const saveTask = async (brief: SearchBrief, id?: string) => {
		setSavingNeed(id ?? "new");
		try {
			// 表单不改标题与检查频率：编辑沿用云端原值，新建才由描述生成标题、按手动检查。
			const input = id && activeTask ? editOf(brief, activeTask) : inputOf({ ...brief, frequency: "手动" });
			const saved = id ? await api.updateWatchTask(id, input) : await api.createWatchTask(input);
			await qc.invalidateQueries({ queryKey: [...WATCH_TASKS_KEY] });
			closePanel();
			navigate("/me/market/needs?task=" + saved.id, { replace: true });
			toast(id ? "寻找条件已更新" : "需求已存到云端，装有市场插件的 Bot 会按它的排程检查");
			return true;
		} catch (error) {
			toast(needError(error), true);
			return false;
		} finally {
			setSavingNeed(undefined);
		}
	};
	const toggleNeed = async (id: string, active: boolean) => {
		setSavingNeed(id);
		try {
			await api.updateWatchTask(id, { active });
			await qc.invalidateQueries({ queryKey: [...WATCH_TASKS_KEY] });
		} catch (error) {
			toast(needError(error), true);
		} finally {
			setSavingNeed(undefined);
		}
	};
	const deleteNeed = async (task: AgentTask) => {
		if (!window.confirm(`删除需求「${task.title}」？云端记录会一起删除。`)) return;
		setSavingNeed(task.id);
		try {
			await api.deleteWatchTask(task.id);
			await qc.invalidateQueries({ queryKey: [...WATCH_TASKS_KEY] });
			if (params.get("task") === task.id) setParams({});
			toast("需求已删除");
		} catch (error) {
			toast(needError(error), true);
		} finally {
			setSavingNeed(undefined);
		}
	};
	const saveListing = async (listing: Listing): Promise<boolean> => {
		if (listing.image.startsWith("data:")) {
			toast("草稿中的图片无法发布，请重新编辑草稿", true);
			return false;
		}
		const { kind: listingKind, ...input } = listingInput(listing, editing);
		try {
			if (editing) await api.updateListing(editing.id, input);
			else await api.createListing({ ...input, kind: listingKind });
		} catch (error) {
			toast(marketError(error), true);
			return false;
		}
		await qc.invalidateQueries({ queryKey: ["market-listings"] });
		setMineTab("published");
		navigate("/me/shop", { replace: true, state: location.state });
		toast(editing ? "修改已保存" : "已发布，可在「我的小店」管理");
		return true;
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
	if (route.section === "posts") return <Navigate to={"/me/shop" + location.search} replace state={location.state} />;
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
										{searching ? "搜索结果" : channel?.label} · {shown.length}
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
							{(collectionView ? lookup.isPending : listingsQuery.isPending) && (
								<div className="mk-feed-grid" aria-busy="true">
									<span className="sr-only">正在加载市场</span>
									{["a", "b", "c", "d", "e", "f"].map((slot) => (
										<div key={slot} className="mk-skeleton-card" />
									))}
								</div>
							)}
							{(collectionView ? lookup.isError : listingsQuery.isError) && (
								<div className="mk-empty" role="alert">
									<X size={30} />
									<h3>加载失败</h3>
									<p>没能连上市场服务，请检查网络后重试。</p>
									<button
										type="button"
										className="mk-button mk-primary"
										onClick={() => void (collectionView ? lookup.refetch() : listingsQuery.refetch())}
									>
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
												shopAvailable={marketSupport.data?.sellerShops === true && !marketSupport.isError}
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
										</div>
									)}
									{shown.length > visibleCount || (!collectionView && listingsQuery.hasNextPage) ? (
										<button
											type="button"
											className="mk-load-more"
											disabled={listingsQuery.isFetchingNextPage}
											onClick={() => {
												setVisibleCount((n) => n + 12);
												if (shown.length <= visibleCount && listingsQuery.hasNextPage)
													void listingsQuery.fetchNextPage();
											}}
										>
											继续逛
											<ArrowDown size={16} />
										</button>
									) : (
										shown.length > 0 && <p className="mk-feed-end">已经看到这里了</p>
									)}
								</>
							)}
						</>
					)}
					{view === "stats" && <MarketStats listings={listings} onStats={(l) => openPanel("stats", { item: l.id })} />}
					{view === "agent" && (
						<AgentWorkspace
							tasks={needTasks}
							loading={watch.isPending}
							error={watch.error instanceof Error ? watch.error : null}
							matches={matches}
							onDelegate={(task) => setHandoff(needContext(task))}
							selectedId={activeTask?.id}
							onSelect={(id) => setParams({ task: id })}
							onBack={() => setParams({})}
							onNew={() => openPanel("brief")}
							onEdit={() => openPanel("brief")}
							onToggle={toggleNeed}
							onDelete={deleteNeed}
							onOpen={openDetail}
							onCompare={compareMany}
							busy={savingNeed}
						/>
					)}
					{ownFeed && listingsQuery.hasNextPage && <p className="mk-muted">以下为已加载发布，可继续加载</p>}
					{view === "selling" && listingsReady && (
						<SellerWorkspace
							listings={listings}
							saved={state.saved}
							tab={mineTab}
							onTab={setMineTab}
							onEdit={(l) => openPanel("publish", { edit: l.id })}
							onToggle={(id) => {
								const item = referenced.find((l) => l.id === id);
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
					{ownFeed && listingsQuery.isPending && (
						<p role="status" aria-busy="true">
							正在加载发布
						</p>
					)}
					{ownFeed && listingsQuery.hasNextPage && (
						<button
							type="button"
							className="mk-load-more"
							disabled={listingsQuery.isFetchingNextPage}
							onClick={() => void listingsQuery.fetchNextPage()}
						>
							加载更多发布
						</button>
					)}
					{ownFeed && listingsQuery.isError && (
						<button type="button" onClick={() => void (collectionView ? lookup.refetch() : listingsQuery.refetch())}>
							加载失败，重试
						</button>
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
				saving={!!savingNeed}
				onSave={saveTask}
			/>
			<PublishDialog
				capabilities={marketSupport.isError ? undefined : marketSupport.data}
				capabilityError={marketSupport.isError}
				retryCapabilities={() => void marketSupport.refetch()}
				open={panel === "publish"}
				close={closePanel}
				editing={editing}
				storageKey={storageKey}
				onPublish={saveListing}
			/>
			<ListingDetail
				shopAvailable={marketSupport.data?.sellerShops === true && !marketSupport.isError}
				listing={panel === "detail" ? detail : null}
				match={activeMatches.find((m) => m.listing.id === detail?.id)}
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
					matches={activeMatches}
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
