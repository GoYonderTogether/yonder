import { useStore } from "@nanostores/react";
import { Link, useLocation } from "react-router";
import { internalState } from "../lib/navigation";
import { $session } from "../store";
import { Avatar } from "../ui/Avatar";

/** The avatar goes straight to the existing personal page. */
export function PersonalAvatar() {
	const me = useStore($session)?.actor;
	const location = useLocation();
	if (!me) return null;
	return (
		<Link
			to="/me"
			state={internalState(location)}
			aria-label="打开个人页"
			className="press shrink-0 rounded-full lg:hidden"
		>
			<Avatar actor={me} size={32} />
		</Link>
	);
}
