import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus } from "lucide-react";
import { useCallback, useRef } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { AppBar, BackButton } from "../components/AppBar";
import { EmptyPane } from "../components/EmptyPane";
import { ListHeader } from "../components/ListHeader";
import { ContactDetail } from "../components/wallet/ContactDetail";
import { ContactList, type ContactTab, FixedRows, TABS } from "../components/wallet/ContactList";
import { WalletBoard, WalletStrip } from "../components/wallet/DesktopWallet";
import { MobileWallet } from "../components/wallet/Wallet";
import { cn } from "../lib/cn";
import { internalState } from "../lib/navigation";
import { socialLoadError } from "../lib/socialError";
import { useDesktop } from "../lib/useDesktop";
import { useEntityId } from "../lib/useEntityId";
import { $session } from "../store";
import { Button } from "../ui/Button";

/** 旧 /cards、/cards/:id 地址：进通讯录并展开卡包。 */
export function CardsRedirect() {
	const { id } = useParams();
	const loc = useLocation();
	return <Navigate state={loc.state} to={`/contacts?wallet=${id ? encodeURIComponent(id) : 1}`} replace />;
}

function SearchBox({ q, onChange }: { q: string; onChange: (q: string) => void }) {
	return (
		<label className="field flex h-10 items-center gap-2 rounded-control bg-tone px-3 text-faint">
			<Search size={16} />
			<input
				value={q}
				onChange={(e) => onChange(e.target.value)}
				placeholder="搜索"
				className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
			/>
		</label>
	);
}

/** 通讯录：上面是我的名片卡包，下面是联系人。 */
export function Contacts() {
	const desktop = useDesktop();
	const nav = useNavigate();
	const loc = useLocation();
	const { id: ref } = useParams();
	const resolved = useEntityId("actor", ref);
	const id = resolved.id;
	const [sp, setSp] = useSearchParams();
	const q = sp.get("q") ?? "";
	const setQ = (value: string) => {
		const next = new URLSearchParams(sp);
		if (value) next.set("q", value);
		else next.delete("q");
		setSp(next, { replace: true });
	};
	const scroller = useRef<HTMLDivElement | null>(null);
	const savedScroll = useRef(0);
	const attachScroller = useCallback((node: HTMLDivElement | null) => {
		if (scroller.current) savedScroll.current = scroller.current.scrollTop;
		scroller.current = node;
		if (node) node.scrollTop = savedScroll.current;
	}, []);
	const me = useStore($session)?.actor;
	const anon = !!me?.anonymous;
	const { data: all = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	const tab = (TABS.find((t) => t.id === sp.get("tab"))?.id ?? "friends") as ContactTab;
	const wallet = sp.get("wallet");
	const known = me?.id === id ? me : all.find((a) => a.id === id);
	const detail = useQuery({
		queryKey: ["actor", id],
		queryFn: async () => (await api.actors([id!]))[0] ?? null,
		enabled: !!id && !known,
	});
	const selected = known ?? detail.data;
	const loading = resolved.pending || (!!id && detail.isPending);
	const failure = resolved.failure ?? (detail.isError ? detail.error : null);
	const detailPane = selected ? (
		<ContactDetail key={selected.id} a={selected} desktop={desktop} />
	) : ref ? (
		<div className="flex h-full flex-col bg-ground">
			<AppBar title="联系人" left={<BackButton to="/contacts" />} />
			<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-muted">
				<p role={failure ? "alert" : "status"}>
					{loading
						? "正在加载联系人…"
						: failure
							? socialLoadError(failure, "加载联系人失败")
							: "联系人不存在或无法访问"}
				</p>
				{!loading && failure && <Button onClick={() => void (id ? detail.refetch() : resolved.retry())}>重试</Button>}
				{!loading && !failure && <Button onClick={() => nav("/friends/add")}>添加好友</Button>}
				<Button onClick={() => nav("/contacts")}>返回通讯录</Button>
			</div>
		</div>
	) : null;
	if (!me) return null;

	if (desktop) {
		return (
			<div className="flex h-full">
				<aside className="flex w-80 shrink-0 flex-col">
					<ListHeader q={q} onChange={setQ} />
					{!anon && (
						<WalletStrip
							active={wallet !== null}
							onClick={() => nav("/contacts?wallet=1", { state: internalState(loc) })}
						/>
					)}
					<nav className="scroll-y flex-1 px-2 pb-2">
						<FixedRows />
						<ContactList q={q} tab={tab} desktop active={id} meId={me.id} />
					</nav>
				</aside>
				<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground lg:my-2 lg:mr-2 lg:rounded-[24px] lg:shadow-soft">
					{ref ? (
						detailPane
					) : wallet !== null && !anon ? (
						<WalletBoard focus={wallet === "1" ? undefined : wallet} />
					) : (
						<EmptyPane />
					)}
				</main>
			</div>
		);
	}

	if (ref) return detailPane;
	return (
		<div className="flex h-full flex-col bg-ground">
			<AppBar
				title={<span className="text-[20px] tracking-tight">通讯录</span>}
				right={
					<button
						type="button"
						aria-label="添加朋友"
						onClick={() => nav("/friends/add", { state: internalState(loc) })}
						className="press flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-tone"
					>
						<UserPlus size={21} strokeWidth={1.75} />
					</button>
				}
			/>
			<div ref={attachScroller} className="scroll-y min-h-0 flex-1">
				{!anon && <MobileWallet scroller={scroller} />}
				<div className="px-4 pb-6">
					<div className="pt-2 pb-2">
						<SearchBox q={q} onChange={setQ} />
					</div>
					<FixedRows />
					<div role="tablist" aria-label="分类" className="my-3 flex rounded-full bg-tone p-1">
						{TABS.map((t) => (
							<button
								type="button"
								key={t.id}
								role="tab"
								aria-selected={tab === t.id}
								onClick={() => {
									const next = new URLSearchParams(sp);
									next.set("tab", t.id);
									setSp(next, { replace: true });
								}}
								className={cn(
									"press h-9 flex-1 rounded-full text-small",
									tab === t.id ? "bg-raised font-medium shadow-soft" : "text-muted",
								)}
							>
								{t.label}
							</button>
						))}
					</div>
					<ContactList q={q} tab={tab} meId={me.id} />
				</div>
			</div>
		</div>
	);
}
