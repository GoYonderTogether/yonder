import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Page } from "../components/AppBar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { Window } from "../ui/Window";

/**
 * 我的记忆（主人 2026-11-05 要求）：主 Bot 的云端记忆库。
 * 上面是 Bot 维护的自我画像（me/now.md，随每日晚报更新，可手改）；
 * 下面是按来源分组的文档（时间线 / 资料 / 关于我 …），每份可查看、编辑、删除。
 * 文案最小化，如实展示 404（主 Bot 不在云端或记忆库还没建立）。
 */
export function Memory() {
	const client = useQueryClient();
	const [editing, setEditing] = useState<
		{ path: string; title: string; initial: string; summary: boolean } | undefined
	>();
	const page = useQuery({ queryKey: ["memory"], queryFn: api.memory, retry: 1 });
	const documents = useQuery({ queryKey: ["memory-documents"], queryFn: api.memoryDocuments, retry: 1 });
	const refresh = () => {
		void client.invalidateQueries({ queryKey: ["memory"] });
		void client.invalidateQueries({ queryKey: ["memory-documents"] });
	};
	const summary = useMutation({
		mutationFn: (text: string) => api.saveMemorySummary(text),
		onSuccess: () => {
			toast("已保存");
			setEditing(undefined);
			refresh();
		},
		onError: (error: Error) => toast(error.message || "保存失败", true),
	});
	const document = useMutation({
		mutationFn: (input: { path: string; text?: string; remove?: boolean }) =>
			input.remove ? api.deleteMemoryDocument(input.path) : api.saveMemoryDocument(input.path, input.text ?? ""),
		onSuccess: () => {
			toast("已删除");
			setEditing(undefined);
			refresh();
		},
		onError: (error: Error) => toast(error.message || "操作失败", true),
	});
	if (page.isPending || documents.isPending)
		return (
			<Page title="我的记忆">
				<p className="text-small text-muted">正在读取记忆…</p>
			</Page>
		);
	if (page.isError || !page.data)
		return (
			<Page title="我的记忆">
				<div className="rounded-card bg-raised p-5" role="alert">
					<p className="text-small text-muted">
						云端主 Bot 还没有可读的记忆。主 Bot 移到设备上时，记忆在设备自己的存储里。
					</p>
					<Button className="mt-4 h-9" onClick={() => void page.refetch()}>
						重试
					</Button>
				</div>
			</Page>
		);
	const data = page.data;
	return (
		<Page title="我的记忆">
			{data.summary && (
				<section className="rounded-card bg-raised p-5" aria-label="自我画像">
					<div className="flex items-center justify-between">
						<h2 className="text-small font-medium text-muted">自我画像</h2>
						<div className="flex items-center gap-1">
							<button
								type="button"
								className="press flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-tone"
								aria-label="编辑自我画像"
								onClick={() =>
									setEditing({
										path: "me/now.md",
										title: "编辑自我画像",
										initial: data.summary?.text ?? "",
										summary: true,
									})
								}
							>
								<Pencil size={16} />
							</button>
						</div>
					</div>
					<p className="mt-1 text-caption text-faint">
						{data.bot.name} 会随对话更新 · 更新于{" "}
						{new Date(data.summary.updatedAt).toLocaleString("zh-CN", {
							month: "numeric",
							day: "numeric",
							hour: "2-digit",
							minute: "2-digit",
						})}
					</p>
					<p className="mt-3 text-body whitespace-pre-wrap">{data.summary.text || "（Bot 还没有写下内容）"}</p>
				</section>
			)}
			{!data.summary && (
				<section className="rounded-card bg-raised p-5" aria-label="自我画像">
					<h2 className="text-small font-medium text-muted">自我画像</h2>
					<p className="mt-2 text-small text-muted">
						{data.bot.name} 还没有写下关于你的画像。和它多聊聊，或等每日晚报整理。
					</p>
				</section>
			)}
			<section className="flex flex-col gap-3" aria-label="记忆文档">
				{documents.isError && (
					<div className="rounded-card bg-raised p-5" role="alert">
						<p className="text-small text-danger">记忆文档读取失败：{documents.error.message}</p>
						<Button className="mt-3 h-9" onClick={() => void documents.refetch()}>
							重试
						</Button>
					</div>
				)}
				{documents.data?.groups.map((group) => (
					<div key={group.source} className="overflow-hidden rounded-card bg-raised">
						<div className="px-5 pt-4 pb-1">
							<h2 className="text-small font-medium text-muted">{group.label}</h2>
						</div>
						<ul className="divide-y divide-hairline">
							{group.documents.map((doc) => (
								<li key={doc.path}>
									<button
										type="button"
										className="press flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-tone"
										onClick={() => void openDocument(doc.path, setEditing, client)}
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate text-body">{docPathTitle(doc.path)}</span>
											<span className="mt-0.5 block truncate text-caption text-faint">{doc.preview || "（空）"}</span>
										</span>
										<ChevronRight size={16} className="shrink-0 text-faint" />
									</button>
								</li>
							))}
						</ul>
					</div>
				))}
				{documents.data && !documents.isError && documents.data.groups.length === 0 && (
					<div className="rounded-card bg-raised p-5">
						<p className="text-small text-muted">还没有记忆文档。和 {data.bot.name} 聊天，它会记录你们说过的话。</p>
					</div>
				)}
			</section>
			<MemoryEditor state={editing} onClose={() => setEditing(undefined)} summary={summary} document={document} />
		</Page>
	);
}

async function openDocument(
	path: string,
	setEditing: (state: { path: string; title: string; initial: string; summary: boolean }) => void,
	_client: ReturnType<typeof useQueryClient>,
) {
	try {
		const doc = await api.memoryDocument(path);
		setEditing({ path, title: docPathTitle(path), initial: doc.text, summary: false });
	} catch (error) {
		toast(error instanceof Error ? error.message : "读取失败", true);
	}
}

function docPathTitle(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.(md|markdown|txt)$/i, "");
}

/** 编辑浮窗：自我画像与普通文档共用；文档多一个删除入口（自我画像不可删）。 */
function MemoryEditor({
	state,
	onClose,
	summary,
	document: doc,
}: {
	state: { path: string; title: string; initial: string; summary: boolean } | undefined;
	onClose: () => void;
	summary: { isPending: boolean; mutate: (text: string) => void };
	document: { isPending: boolean; mutate: (input: { path: string; text?: string; remove?: boolean }) => void };
}) {
	const [text, setText] = useState(state?.initial ?? "");
	const [loaded, setLoaded] = useState(state?.path);
	const [confirming, setConfirming] = useState(false);
	if (state && loaded !== state.path) {
		setText(state.initial);
		setLoaded(state.path);
		setConfirming(false);
	}
	if (!state)
		return (
			<Window open={false} onOpenChange={onClose} title="">
				{null}
			</Window>
		);
	const dirty = text !== state.initial;
	return (
		<Window
			open
			onOpenChange={(open) => !open && onClose()}
			title={state.title}
			className="w-[min(560px,calc(100vw-2rem))]"
		>
			<div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
				<textarea
					rows={12}
					className="field min-h-[40vh] w-full flex-1 rounded-control bg-tone p-3.5 text-body text-ink outline-none"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
				<div className="flex items-center justify-between gap-2">
					{state.summary || confirming ? (
						<span />
					) : confirming === false ? (
						<Button
							variant="ghost"
							className="h-9 text-danger"
							disabled={doc.isPending}
							onClick={() => setConfirming(true)}
						>
							<Trash2 size={15} aria-hidden /> 删除
						</Button>
					) : null}
					{confirming && (
						<Button
							variant="ghost"
							className="h-9 text-danger"
							disabled={doc.isPending}
							onClick={() => doc.mutate({ path: state.path, remove: true })}
						>
							确认删除
						</Button>
					)}
				</div>
				<div className="flex gap-2">
					<Button
						variant="primary"
						disabled={summary.isPending || doc.isPending || !dirty}
						onClick={() => (state.summary ? summary.mutate(text) : doc.mutate({ path: state.path, text }))}
					>
						保存
					</Button>
					<Button variant="ghost" onClick={onClose}>
						取消
					</Button>
				</div>
			</div>
		</Window>
	);
}
