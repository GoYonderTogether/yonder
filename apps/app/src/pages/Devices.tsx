import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AppBar, BackButton } from "../components/AppBar";
import { DeviceDetail } from "../components/devices/DeviceDetail";
import { DeviceList } from "../components/devices/DeviceList";
import { useAccountDevices } from "../components/devices/queries";
import { DeviceSheet } from "../components/wallet/DeviceSheet";
import { Button } from "../ui/Button";

/**
 * 设备列表与详情（research/04 §4 流程 1、2）。
 * 同一组件挂两处入口：/me/devices 与 /work/devices —— 设备是一个对象，不是筛选项。
 */
export function MeDevices({ accountId }: { accountId: string }) {
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<div className="lg:hidden">
				<AppBar title="设备" left={<BackButton to="/me" />} />
			</div>
			<div className="mx-auto max-w-3xl pb-24 lg:px-8 lg:pb-10">
				<h1 className="display hidden pt-10 pb-6 lg:block">设备</h1>
				<div className="overflow-hidden rounded-card bg-raised">
					<DeviceList accountId={accountId} base="/me/devices" />
				</div>
				<p className="px-4 py-3 text-caption text-faint lg:px-0">
					这里的设备包括本地电脑、云端运行时和接入的外部 harness。改名与解绑在设备详情页。
				</p>
			</div>
		</div>
	);
}

export function MeDevice({ accountId }: { accountId: string }) {
	const { id = "" } = useParams();
	const nav = useNavigate();
	const qc = useQueryClient();
	const [managing, setManaging] = useState(false);
	const devices = useAccountDevices(accountId);
	const device = devices.data?.find((item) => item.id === id);
	const bots = devices.data ?? [];
	if (devices.isPending)
		return (
			<div className="flex h-full flex-col bg-ground">
				<AppBar title="设备" left={<BackButton to="/me/devices" />} />
				<p role="status" className="flex flex-1 items-center justify-center p-6 text-small text-muted">
					正在读取设备…
				</p>
			</div>
		);
	if (!device)
		return (
			<div className="flex h-full flex-col bg-ground">
				<AppBar title="设备" left={<BackButton to="/me/devices" />} />
				<div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-small">
					<p className="text-muted">找不到这台设备，它可能已经解绑。</p>
					<Button onClick={() => nav("/me/devices", { replace: true })}>返回设备列表</Button>
				</div>
			</div>
		);
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["account-devices", accountId] });
		void qc.invalidateQueries({ queryKey: ["contacts"] });
	};
	return (
		<div className="scroll-y h-full bg-ground lg:m-2 lg:ml-0 lg:h-[calc(100%-1rem)] lg:rounded-panel lg:shadow-soft">
			<div className="lg:hidden">
				<AppBar title={device.name} left={<BackButton to="/me/devices" />} />
			</div>
			<div className="mx-auto max-w-3xl pb-24 lg:px-8 lg:pb-10">
				<h1 className="display hidden pt-10 pb-2 lg:block">{device.name}</h1>
				<div className="flex px-4 pb-4 lg:px-0">
					<Button size="sm" onClick={() => setManaging(true)}>
						改名或解绑
					</Button>
				</div>
				<div className="px-4 lg:px-0">
					<DeviceDetail device={device} accountId={accountId} workBase="/work/device" />
				</div>
			</div>
			{/* 解绑是不可撤销动作，成功后回到列表；改名留在本页刷新。 */}
			<DeviceSheet
				device={device}
				agents={bots.length}
				open={managing}
				onOpenChange={setManaging}
				onChanged={refresh}
				onRemoved={() => {
					refresh();
					nav("/me/devices", { replace: true });
				}}
			/>
		</div>
	);
}
