import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, IdCard, Monitor } from "lucide-react";
import { Link } from "react-router";
import { api } from "../../api";
import { $session } from "../../store";

/** 新用户消息页的下一步：还没连电脑时，给「做我的名片」和「装 Yonder 连接电脑」两个入口。 */
export function NextSteps() {
	const me = useStore($session)?.actor;
	const { data: devices } = useQuery({ queryKey: ["devices"], queryFn: api.devices, enabled: !!me && !me.anonymous });
	if (!me || me.anonymous || !devices || devices.length) return null;
	const row = "press flex min-h-12 items-center gap-3 rounded-control px-3 hover:bg-tone";
	return (
		<section aria-label="下一步" className="mx-2 mb-2 rounded-card bg-raised p-1 shadow-soft">
			<h2 className="px-3 pt-2 pb-1 text-caption text-muted">下一步</h2>
			<Link to="/me?card=new" className={row}>
				<IdCard size={20} strokeWidth={1.75} className="text-muted" />
				<span className="flex-1 text-small">做我的名片</span>
				<ChevronRight size={16} className="text-faint" />
			</Link>
			<Link to="/get" className={row}>
				<Monitor size={20} strokeWidth={1.75} className="text-muted" />
				<span className="flex-1 text-small">装 Yonder，连接电脑</span>
				<ChevronRight size={16} className="text-faint" />
			</Link>
		</section>
	);
}
