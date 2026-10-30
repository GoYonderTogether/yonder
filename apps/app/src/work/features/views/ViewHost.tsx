import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { rpc } from "../../api/client";
import { mux } from "../../api/stream";

interface ViewDecl {
	id: string;
	title: string;
	placement: "rail" | "floating" | "page";
	actions?: string[];
}
type Content =
	| { type: "markdown"; text: string }
	| { type: "list"; items: { id: string; title: string; subtitle?: string }[] }
	| { type: "kv"; rows: { k: string; v: string }[] }
	| { type: "choice"; prompt: string; options: { id: string; label: string }[] }
	| { type: "input"; prompt: string; placeholder?: string }
	| { type: "builtin"; id: string; payload: unknown };
interface Data {
	rev: number;
	content: Content;
}

/** 插件视图通用渲染：内容来自 views.data，回答经 views.act（带会话与修订号）。 */
function ViewCard({ view, session }: { view: ViewDecl; session: string }) {
	const qc = useQueryClient();
	const key = ["view-data", session, view.id];
	const query = useQuery({
		queryKey: key,
		queryFn: () => rpc<Data>("views.data", { viewId: view.id, session }),
		retry: false,
	});
	const [text, setText] = useState("");
	const act = useMutation({
		mutationFn: (answer: string) =>
			rpc("views.act", {
				viewId: view.id,
				action: view.actions?.[0] ?? "answer",
				session,
				input: { rev: query.data?.rev, answer },
			}),
		onSuccess: () => {
			setText("");
			void qc.invalidateQueries({ queryKey: key });
		},
	});
	if (query.isPending) return <p className="text-caption text-faint">正在读取</p>;
	if (query.isError) return <p className="text-caption text-faint">{view.title}读取失败</p>;
	const c = query.data.content;
	if (c.type === "list" && !c.items.length) return null;
	const canAct = !!view.actions?.length;
	return (
		<section className="text-small" aria-label={view.title}>
			{c.type === "markdown" && <p className="whitespace-pre-wrap">{c.text}</p>}
			{c.type === "list" && (
				<ul className="flex flex-col gap-1">
					{c.items.map((i) => (
						<li key={i.id}>
							{i.title}
							{i.subtitle && <span className="ml-2 text-caption text-faint">{i.subtitle}</span>}
						</li>
					))}
				</ul>
			)}
			{c.type === "kv" && (
				<dl className="grid grid-cols-[6em_1fr] gap-y-0.5 text-caption">
					{c.rows.map((r) => (
						<div key={r.k} className="contents">
							<dt className="text-muted">{r.k}</dt>
							<dd>{r.v}</dd>
						</div>
					))}
				</dl>
			)}
			{c.type === "choice" && (
				<div>
					<p className="mb-1">{c.prompt}</p>
					<div className="flex flex-wrap gap-2">
						{c.options.map((o) => (
							<button
								key={o.id}
								type="button"
								disabled={!canAct || act.isPending}
								onClick={() => act.mutate(o.id)}
								className="rounded-control bg-tone px-2.5 py-1 text-caption hover:bg-tone-2 disabled:opacity-50"
							>
								{o.label}
							</button>
						))}
					</div>
				</div>
			)}
			{c.type === "input" && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (text.trim()) act.mutate(text.trim());
					}}
				>
					<label className="mb-1 block" htmlFor={`v-${view.id}`}>
						{c.prompt}
					</label>
					<div className="flex gap-2">
						<input
							id={`v-${view.id}`}
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder={c.placeholder}
							className="field min-w-0 flex-1 rounded-control bg-tone px-2.5 py-1 text-caption outline-none"
						/>
						<button
							type="submit"
							disabled={!canAct || act.isPending || !text.trim()}
							className="rounded-control bg-accent px-2.5 py-1 text-caption text-on-accent disabled:opacity-40"
						>
							提交
						</button>
					</div>
				</form>
			)}
			{act.isError && <p className="mt-1 text-caption text-danger">提交失败：{(act.error as Error).message}</p>}
		</section>
	);
}

/** 右栏「视图」：views.list 取本会话可见的插件视图（后台任务另有专属卡片）。 */
export function ViewHost({ session }: { session: string }) {
	const qc = useQueryClient();
	const list = useQuery({
		queryKey: ["view-list", session],
		queryFn: () => rpc<{ views: ViewDecl[] }>("views.list", { session }),
		retry: false,
	});
	useEffect(
		() =>
			mux.subscribe(
				"views.watch",
				{ session },
				{
					onReady: () => {
						void qc.invalidateQueries({ queryKey: ["view-list", session] });
					},
					onEvent: (_t, data) => {
						void qc.invalidateQueries({ queryKey: ["view-list", session] });
						for (const id of (data as { ids?: string[] }).ids ?? [])
							void qc.invalidateQueries({ queryKey: ["view-data", session, id] });
					},
				},
			),
		[qc, session],
	);
	if (list.isPending) return <p className="text-caption text-faint">正在读取</p>;
	if (list.isError) return <p className="text-caption text-faint">暂时读不到插件视图</p>;
	const views = list.data.views.filter((v) => !v.id.startsWith("core.background."));
	if (!views.length) return <p className="text-caption text-faint">还没有插件提供的视图</p>;
	return (
		<div className="flex flex-col gap-3">
			{views.map((v) => (
				<ViewCard key={v.id} view={v} session={session} />
			))}
		</div>
	);
}
