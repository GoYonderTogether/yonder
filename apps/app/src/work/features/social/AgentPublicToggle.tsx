import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Actor, httpApi } from "../../api/social";
import { toast } from "../../ui/kit/Toast";
import { messageOf } from "./lib/session";

/**
 * 公开开关只走真实 API：保存中禁用输入，失败时保留原值并同时给出行内提示和 toast，
 * 成功后失效联系人/资料缓存让显示回到服务端事实。
 */
export function AgentPublicToggle({ actor }: { actor: Actor }) {
	const client = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	return (
		<div className="flex flex-col gap-1">
			<label className="flex min-h-11 items-center gap-2 text-small">
				<input
					type="checkbox"
					checked={!!actor.public}
					disabled={busy}
					aria-busy={busy}
					aria-describedby={error ? `${actor.id}-public-error` : undefined}
					onChange={async (event) => {
						const next = event.target.checked;
						setBusy(true);
						setError("");
						try {
							await httpApi.setAgentPublic(actor.id, next);
							await Promise.all(
								["contacts", "contact", "actors", "profile"].map((key) =>
									client.invalidateQueries({ queryKey: [key] }),
								),
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
				<p id={`${actor.id}-public-error`} role="alert" className="text-caption text-danger">
					{error}
				</p>
			)}
		</div>
	);
}
