import { useApplyUpdate, useDownloadUpdate, useUpdateState } from "../../api/update";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { aboutRows, updateSummary } from "./rows";

/**
 * 关于分区：版本与更新入口。更新走网关 update.*（local 节点），
 * 只有状态 ready 才出现应用按钮；远程节点与后端未注册时只说明不可用。
 * 现有 UpdateNotice（静态资源版本提示）是另一条更新提示，不在这里替代。
 */
export function AboutSection() {
	const view = useUpdateState();
	const download = useDownloadUpdate();
	const apply = useApplyUpdate();
	const summary = updateSummary(view);
	const busy = download.isPending || apply.isPending;
	const run = async () => {
		try {
			if (summary.action === "apply") {
				const result = await apply.mutateAsync();
				toast(result.ok ? (result.hint ?? "更新已应用") : (result.hint ?? "更新未应用"));
			} else {
				await download.mutateAsync();
			}
		} catch (error) {
			toast(error instanceof Error ? error.message : "更新操作失败", true);
		}
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-about">
			<h2 className="mb-2 text-body font-medium">关于</h2>
			<dl className="grid grid-cols-[6em_1fr] gap-y-1.5 text-small">
				{aboutRows(view).map((row) => (
					<div key={row.key} className="contents">
						<dt className="text-muted">{row.label}</dt>
						<dd className="min-w-0 break-words">{row.value}</dd>
					</div>
				))}
			</dl>
			{summary.action !== "none" && (
				<Button variant="secondary" size="sm" className="mt-3" disabled={busy} onClick={() => void run()}>
					{busy ? "处理中…" : summary.actionLabel}
				</Button>
			)}
		</section>
	);
}
