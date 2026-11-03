import { useQuery } from "@tanstack/react-query";
import { ChevronRight, RefreshCw } from "lucide-react";
import { Link, useLocation } from "react-router";
import { api } from "../../api";
import type { Device } from "../../api/types";
import { cn } from "../../lib/cn";
import { internalState } from "../../lib/navigation";
import { Button } from "../../ui/Button";
import { hasWorkCache } from "../../work/lib/offlineCache";
import { deviceIcon } from "../wallet/DeviceSheet";
import { useAccountDevices } from "./queries";
import {
	DEVICE_KIND_WORD,
	DEVICE_STATE_WORD,
	deviceState,
	EXECUTOR_WORD,
	executorState,
	lastActivity,
	protocolWord,
} from "./state";

/**
 * 设备列表（research/04 §4 流程 1）：每台已绑定设备一行，含云端运行时与外部 harness。
 * 同一组件挂在「我」的 /me/devices 与工作的 /work/devices 下；行内没有菜单，操作都在设备详情页。
 */
export function DeviceList({ accountId, base }: { accountId: string; base: "/me/devices" | "/work/devices" }) {
	const loc = useLocation();
	const query = useAccountDevices(accountId);
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: api.contacts, enabled: !!accountId, retry: false });
	const forbidden =
		!!query.error && "status" in query.error && [401, 403].includes((query.error as { status: number }).status);
	if (query.isPending)
		return (
			<p role="status" className="px-5 py-4 text-small text-muted">
				正在读取设备…
			</p>
		);
	if (forbidden)
		return (
			<p role="alert" className="px-5 py-4 text-small text-danger">
				设备访问权限已失效，请重新登录。
			</p>
		);
	if (query.isError)
		return (
			<div role="alert" className="flex items-center justify-between gap-3 px-5 py-4 text-small text-muted">
				<span>无法读取设备，请检查连接后重试。</span>
				<Button size="sm" onClick={() => void query.refetch()}>
					<RefreshCw size={14} />
					重试
				</Button>
			</div>
		);
	const devices = query.data ?? [];
	if (!devices.length)
		return (
			<div className="px-5 py-4 text-small text-muted">
				<p>还没有绑定设备。</p>
				<Link to="/connect" state={internalState(loc)} className="mt-2 inline-block text-accent-ink underline">
					添加设备
				</Link>
			</div>
		);
	const bots = contacts.data ?? [];
	return (
		<ul className="divide-y divide-hairline/60">
			{devices.map((device) => (
				<li key={device.id}>
					<DeviceRow
						device={device}
						accountId={accountId}
						base={base}
						bots={bots.filter((actor) => actor.kind === "agent" && actor.deviceId === device.id).length}
					/>
				</li>
			))}
		</ul>
	);
}

function DeviceRow({
	device,
	accountId,
	base,
	bots,
}: {
	device: Device;
	accountId: string;
	base: string;
	bots: number;
}) {
	const loc = useLocation();
	const state = deviceState(device, hasWorkCache(accountId, device.id));
	const executor = executorState(device);
	const activity = lastActivity(device);
	const protocol = protocolWord(device);
	// 执行端只有一个真实状态值得占一行：在线却没有登记（harness 按定义不参与，不显示）。
	const executorNote = executor === "unregistered" || executor === "registered" ? EXECUTOR_WORD[executor] : undefined;
	return (
		<Link
			to={`${base}/${encodeURIComponent(device.id)}`}
			state={internalState(loc)}
			className="press flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-tone-2"
		>
			<span
				aria-hidden
				className={cn(
					"flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-tone",
					state === "online" ? "text-ink" : "text-faint",
				)}
			>
				{(() => {
					const Icon = deviceIcon[device.kind];
					return <Icon size={20} strokeWidth={1.75} />;
				})()}{" "}
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline gap-2">
					<span className="truncate text-body">{device.name}</span>
					<span className="shrink-0 text-caption text-faint">{DEVICE_KIND_WORD[device.kind]}</span>
				</span>
				<span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-caption text-muted">
					<span className={cn(state === "offline" && "text-faint")}>{DEVICE_STATE_WORD[state]}</span>
					{protocol && <span className="text-faint">{protocol}</span>}
					{bots > 0 && <span className="text-faint">{bots} 个 Bot</span>}
					{activity && <span className="text-faint">{activity.label}</span>}
				</span>
				{executorNote && <span className="mt-0.5 block text-caption text-faint">{executorNote}</span>}
			</span>
			<ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
		</Link>
	);
}
