import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../../api";
import type { Device } from "../../api/types";
import { Avatar } from "../../ui/Avatar";
import { rpc } from "../api/client";
import type { ActivitySummary } from "../api/types";
import { workSessions } from "../api/work";
import { titleOf } from "../lib/identity";
import { deviceAgentMap, fetchDeviceAgents } from "../lib/queries";
import { cloudBotEntries, groupWork, TIME_ORDER } from "../lib/work";
import { DragScroll } from "./DragScroll";
import { toast } from "./kit/Toast";

type Props = { accountId: string; devices: Device[]; onOpen(device: Device, session: string): void };

function DeviceWork({ accountId, device, onOpen }: { accountId: string; device: Device; onOpen: Props["onOpen"] }) {
	const navigate = useNavigate();
	const available = device.online && device.workProtocol === 1;
	const sessions = useQuery({
		queryKey: ["all-work", accountId, device.id, "sessions"],
		enabled: available,
		queryFn: () => workSessions({ deviceId: device.id }),
		refetchInterval: 5000,
	});
	const agents = useQuery({
		queryKey: ["all-work", accountId, device.id, "agents"],
		enabled: available,
		queryFn: () => fetchDeviceAgents(device.id),
		refetchInterval: 5000,
	});
	const activity = useQuery({
		queryKey: ["all-work", accountId, device.id, "activity"],
		enabled: available,
		queryFn: () => rpc<ActivitySummary>("activity.summary", {}, undefined, { deviceId: device.id }),
		refetchInterval: 5000,
	});
	const states = new Map(activity.data?.sessions.map((session) => [session.id, session]));
	const groups = groupWork(sessions.data ?? [], states);
	const bots = cloudBotEntries(groups.bots, deviceAgentMap(device.id, agents.data ?? []));
	const tasks = [
		...groups.needsYou,
		...groups.running,
		...groups.pinned,
		...TIME_ORDER.flatMap((key) => groups.byTime[key]),
	];
	return (
		<section className="border-b border-hairline px-4 py-3" aria-label={device.name}>
			<h2 className="text-small font-semibold">{device.name}</h2>
			{!available && (
				<p className="mt-1 text-caption text-muted">{device.online ? "需要更新 Yonder" : "离线 · 显示已加载内容"}</p>
			)}
			{!sessions.data || !agents.data ? (
				available && (sessions.isError || agents.isError) ? (
					<p role="alert" className="mt-1 text-caption text-danger">
						读取设备工作失败
					</p>
				) : available ? (
					<p className="mt-1 text-caption text-muted">加载中…</p>
				) : null
			) : (
				<>
					<button
						type="button"
						disabled={!available}
						className="mt-2 rounded-control bg-tone px-3 py-1 text-small"
						onClick={() =>
							void rpc<{ id: string }>("sessions.open", { preset: "default", close: "manual" }, undefined, {
								deviceId: device.id,
							})
								.then((session) => onOpen(device, session.id))
								.catch(() => toast("新建失败", true))
						}
					>
						新任务
					</button>
					<DragScroll>
						{bots.map(({ actor, session }) => (
							<button
								key={actor.id}
								type="button"
								title={actor.name}
								className="press flex w-14 shrink-0 flex-col items-center gap-1 rounded-card py-1"
								onClick={() => {
									if (session) onOpen(device, session.id);
									else if (available)
										void api
											.openDm(actor.id)
											.then((conversation) => navigate(`/c/${conversation.id}`))
											.catch(() => toast("无法打开 Bot 对话", true));
								}}
							>
								<Avatar actor={actor} size={36} />
								<span className="w-full truncate text-center text-caption text-muted">{actor.name}</span>
							</button>
						))}
					</DragScroll>
					{tasks.map((session) => (
						<button
							key={session.id}
							type="button"
							className="flex w-full items-center gap-2 py-2 text-left text-small"
							onClick={() => onOpen(device, session.id)}
						>
							<span className="w-4 shrink-0" data-testid="session-icon-slot" />
							<span className="min-w-0 truncate">{titleOf(session)}</span>
						</button>
					))}
					{groups.done.length > 0 && (
						<details>
							<summary className="py-2 text-caption text-muted">已完成</summary>
							{groups.done.map((session) => (
								<button
									key={session.id}
									type="button"
									className="flex w-full items-center gap-2 py-2 text-left text-small"
									onClick={() => onOpen(device, session.id)}
								>
									<span className="w-4 shrink-0" data-testid="session-icon-slot" />
									<span className="min-w-0 truncate">{titleOf(session)}</span>
								</button>
							))}
						</details>
					)}
					{!bots.length && !tasks.length && <p className="mt-2 text-caption text-muted">没有工作会话</p>}
				</>
			)}
		</section>
	);
}

export function AllWorkList({ accountId, devices, onOpen }: Props) {
	return (
		<div className="scroll-y h-full" data-testid="all-work-list">
			{devices.map((device) => (
				<DeviceWork key={device.id} accountId={accountId} device={device} onOpen={onOpen} />
			))}
		</div>
	);
}
