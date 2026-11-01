import { useStore } from "@nanostores/react";
import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { internalState } from "../lib/navigation";
import { $session } from "../store";

/** The overview has one entry; editing happens on its own page. */
export function MyCard() {
	const me = useStore($session)?.actor;
	const location = useLocation();
	if (!me || me.anonymous || me.kind !== "human") return null;
	return (
		<Link
			to="/me/edit"
			state={internalState(location)}
			className="press flex min-h-14 items-center justify-between rounded-card bg-raised px-5 hover:bg-tone"
		>
			<span className="font-medium">编辑个人资料</span>
			<ChevronRight size={18} className="text-faint" aria-hidden />
		</Link>
	);
}
