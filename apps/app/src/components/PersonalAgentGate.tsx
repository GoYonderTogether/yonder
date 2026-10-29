import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { usePersonalAgent } from "../lib/personalAgent";
import { useSocialService } from "../lib/useWorkEntry";
import { PageLoading } from "./PageLoading";

/** Public visitor conversations keep their existing flow; signed-in owners select a PA. */
export function PersonalAgentGate({ children }: { children: ReactNode }) {
	const { agent, me, isPending, isError, refetch } = usePersonalAgent();
	const loc = useLocation();
	const social = useSocialService();
	if (social === "none") return children;
	if (["/pa", "/connect"].includes(loc.pathname) || me?.anonymous) return children;
	if (isPending) return <PageLoading />;
	if (isError)
		return (
			<div role="alert" className="p-6 text-small">
				无法读取你的 Bot。
				<button type="button" className="underline" onClick={() => void refetch()}>
					重新加载
				</button>
			</div>
		);
	return agent ? children : <Navigate to="/pa" replace state={{ next: loc.pathname + loc.search }} />;
}
