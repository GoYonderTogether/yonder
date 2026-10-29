import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Actor } from "../api/types";
import { toast } from "../ui/Toast";

export function AgentPublicToggle({ actor }: { actor: Actor }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	return (
		<label className="flex min-h-11 items-center gap-2 text-small">
			<input
				type="checkbox"
				checked={!!actor.public}
				disabled={busy}
				onChange={async (e) => {
					setBusy(true);
					try {
						await api.setAgentPublic(actor.id, e.target.checked);
						await Promise.all(
							["contacts", "actors", "profile"].map((key) => qc.invalidateQueries({ queryKey: [key] })),
						);
					} catch (error) {
						toast(error instanceof Error ? error.message : "公开设置失败", true);
					} finally {
						setBusy(false);
					}
				}}
			/>
			公开到我的个人主页
		</label>
	);
}
