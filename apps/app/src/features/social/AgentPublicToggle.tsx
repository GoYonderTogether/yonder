import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Actor, httpApi } from "../../api/social";
import { toast } from "../../ui/kit/Toast";

export function AgentPublicToggle({ actor }: { actor: Actor }) {
	const client = useQueryClient();
	const [busy, setBusy] = useState(false);
	return (
		<label className="flex min-h-11 items-center gap-2 text-small">
			<input
				type="checkbox"
				checked={!!actor.public}
				disabled={busy}
				onChange={async (event) => {
					setBusy(true);
					try {
						await httpApi.setAgentPublic(actor.id, event.target.checked);
						await Promise.all(
							["contacts", "contact", "actors", "profile"].map((key) => client.invalidateQueries({ queryKey: [key] })),
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
