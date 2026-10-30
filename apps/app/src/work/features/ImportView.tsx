import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { rpc } from "../api/client";
import { fromImport, type ImportShow } from "../lib/imports";
import { Footer } from "../ui/Footer";
import { Transcript } from "../ui/Transcript";

const PAGE = 400;

/** 导入的 pi 会话：读最后一页，可向前翻；只读，没有输入框。 */
export function useImport(id: string | undefined) {
	return useQuery({
		queryKey: ["import", id],
		enabled: !!id,
		queryFn: async () => {
			const head = await rpc<ImportShow>("imports.show", { id, limit: 1 });
			const offset = Math.max(0, head.total - PAGE);
			return rpc<ImportShow>("imports.show", { id, offset, limit: PAGE });
		},
		staleTime: 30_000,
	});
}

export function ImportBody({ id, onOlder }: { id: string; onOlder?: () => void }) {
	const q = useImport(id);
	const items = useMemo(() => fromImport(q.data?.items ?? []), [q.data]);
	if (q.isLoading) return <p className="flex-1 py-16 text-center text-small text-faint">加载中…</p>;
	if (q.isError) return <p className="flex-1 py-16 text-center text-small text-danger">{q.error.message}</p>;
	const d = q.data;
	const model = d?.summary.model;
	const slash = model?.indexOf("/") ?? -1;
	return (
		<>
			<p className="bg-tone/50 px-4 py-1.5 text-caption text-muted" data-testid="readonly-note">
				只读 · 从 pi 导入{d?.offset ? `（显示最近 ${d.items.length} / ${d.total} 条记录）` : ""}
			</p>
			<Transcript items={items} hasMore={false} onOlder={onOlder ?? (() => undefined)} />
			<Footer
				v={{
					ready: true,
					items: [],
					hasMore: false,
					running: false,
					todos: [],
					subtasks: [],
					background: [],
					...(d ? { usage: { self: d.usage.totals } } : {}),
					...(model
						? {
								model:
									slash > 0
										? { provider: model.slice(0, slash), model: model.slice(slash + 1) }
										: { provider: "", model },
							}
						: {}),
				}}
			/>
		</>
	);
}
