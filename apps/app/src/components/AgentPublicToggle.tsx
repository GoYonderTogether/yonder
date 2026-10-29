import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { Actor } from "../api/types";
import { messageOf } from "../lib/verify";
import { toast } from "../ui/Toast";

/**
 * 主人把某个 Bot 公开到自己的主页：「公开到我的个人主页」开关。
 * 点击立即按新值显示（乐观），同时 PUT /api/agents/:id/public；失败回滚到原值、行内提示加 toast。
 * 服务端值变化（重新拉取 contacts/profile）后以服务端为准。
 */
export function AgentPublicToggle({ actor }: { actor: Actor }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	// 本地值只在保存期间与 actor.public 不同；保存结束（成功或回滚）后跟随服务端数据。
	const [on, setOn] = useState(!!actor.public);
	const errorId = `${actor.id}-public-error`;
	useEffect(() => setOn(!!actor.public), [actor.public]);
	return (
		<div className="flex flex-col gap-1">
			<label className="flex min-h-11 items-center gap-2 text-small">
				<input
					type="checkbox"
					checked={on}
					disabled={busy}
					aria-busy={busy}
					aria-describedby={error ? errorId : undefined}
					onChange={async (e) => {
						const next = e.target.checked;
						const previous = !!actor.public;
						setOn(next);
						setBusy(true);
						setError("");
						try {
							await api.setAgentPublic(actor.id, next);
							await Promise.all(
								["contacts", "actors", "profile"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
							);
						} catch (err) {
							// 没发出/没成功就回到原值，别让界面停在服务端没接受的状态。
							setOn(previous);
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
