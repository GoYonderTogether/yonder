import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api";
import { AppBar, BackButton } from "../components/AppBar";
import { EmptyPane } from "../components/EmptyPane";
import { ListHeader } from "../components/ListHeader";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { PlusMenu } from "../components/PlusMenu";
import { ContactDetail } from "../components/wallet/ContactDetail";
import { ContactList } from "../components/wallet/ContactList";
import { socialLoadError } from "../lib/socialError";
import { useDesktop } from "../lib/useDesktop";
import { useEntityId } from "../lib/useEntityId";
import { $session } from "../store";
import { Button } from "../ui/Button";

/** 旧 /cards、/cards/:id、/cards/:id/edit 地址：名片只在「我」里管理。 */
export function CardsRedirect() {
	const { id } = useParams();
	const loc = useLocation();
	const editing = loc.pathname.endsWith("/edit") || id === "new";
	return <Navigate state={loc.state} to={editing ? "/me?card=new" : "/me"} replace />;
}

function SearchBox({ q, onChange }: { q: string; onChange: (q: string) => void }) {
	return (
		<label className="field flex h-10 items-center gap-2 rounded-control bg-tone px-3 text-faint">
			<Search size={16} aria-hidden />
			<input
				value={q}
				onChange={(e) => onChange(e.target.value)}
				placeholder="搜索"
				aria-label="搜索通讯录"
				className="min-w-0 flex-1 bg-transparent text-small text-ink outline-none placeholder:text-faint"
			/>
		</label>
	);
}

/** 通讯录：搜索、好友列表、联系人详情、添加朋友。Bot 在「工作」，群聊在「消息」，名片在「我」。 */
export function Contacts() {
	const desktop = useDesktop();
	const nav = useNavigate();
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
	const me = useStore($session)?.actor;
	const { data: all = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
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
					<nav className="scroll-y flex-1 px-2 pb-2">
						<ContactList q={q} active={id} />
					</nav>
				</aside>
				<main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ground lg:my-2 lg:mr-2 lg:rounded-panel lg:shadow-soft">
					{ref ? detailPane : <EmptyPane />}
				</main>
			</div>
		);
	}

	if (ref) return detailPane;
	return (
		<div className="flex h-full flex-col bg-ground">
			{/* 加号菜单：添加朋友、发起群聊、添加设备、扫一扫合成一个入口（消息页不再有加号）。 */}
			<AppBar
				title={<span className="text-title tracking-tight">通讯录</span>}
				left={<PersonalAvatar />}
				right={<PlusMenu />}
			/>
			<div className="scroll-y min-h-0 flex-1 px-4 pb-6">
				<div className="pt-2 pb-2">
					<SearchBox q={q} onChange={setQ} />
				</div>
				<ContactList q={q} active={id} />
			</div>
		</div>
	);
}
