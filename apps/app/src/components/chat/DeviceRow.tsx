import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { api } from "../../api";
import { Status } from "../../ui/Avatar";

/** 消息页搜索框下的设备行：有在线设备显示在线 Agent 数；都不在线显示灰色；没有设备不显示。 */
export function DeviceRow() {
	const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: api.devices });
	const { data: contacts = [] } = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	if (!devices.length) return null;
	const online = devices.filter((d) => d.online);
	if (!online.length)
		return (
			<p className="flex items-center gap-2 px-5 pb-2 text-[13px] text-faint">
				<Status online={false} className="h-1.5 w-1.5 shrink-0" />
				设备离线
			</p>
		);
	const ids = new Set(online.map((d) => d.id));
	const agents = contacts.filter((a) => a.kind === "agent" && a.online && a.deviceId && ids.has(a.deviceId)).length;
	const where = online.length > 1 ? `${online[0].name} 等 ${online.length} 台设备上` : `${online[0].name} 上`;
	return (
		<Link
			to="/connect"
			className="press mx-2 mb-2 flex h-10 items-center gap-2 rounded-control bg-tone/60 px-3 text-[13px] text-muted hover:bg-tone"
		>
			<Status online className="h-1.5 w-1.5 shrink-0" />
			<span className="min-w-0 flex-1 truncate">
				{where} {agents} 个 Bot 在线
			</span>
			<ChevronRight size={16} className="shrink-0 text-faint" />
		</Link>
	);
}
