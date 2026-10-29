import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Actor } from "../api/types";
import { messageOf } from "../lib/verify";
import { toast } from "../ui/Toast";

/** 保存中禁用并显示「正在保存…」；失败时保留原值，行内提示加 toast。 */
export function AgentPublicToggle({ actor }: { actor: Actor }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const errorId = `${actor.id}-public-error`;
	return (
		<div className="flex flex-col gap-1">
			<label className="flex min-h-11 items-center gap-2 text-small">
				<input
					type="checkbox"
					checked={!!actor.public}
					disabled={busy}
					aria-busy={busy}
					aria-describedby={error ? errorId : undefined}
					onChange={async (e) => {
						setBusy(true);
						setError("");
						try {
							await api.setAgentPublic(actor.id, e.target.checked);
							await Promise.all(
								["contacts", "actors", "profile"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
							);
						} catch (err) {
							const message = messageOf(err, "公开设置失败");
							setError(message);
							toast(message, true);
						} finally {
							setBusy(false);
						}
					}}
				/>
				{busy ? "正在保存…" : "公开到我的个人主页"}
			</label>
			{error && (
				<p id={errorId} role="alert" className="text-caption text-danger">
					{error}
				</p>
			)}
		</div>
	);
}
