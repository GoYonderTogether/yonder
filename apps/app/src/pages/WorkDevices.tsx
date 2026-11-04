import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";
import { DeviceDetail } from "../components/devices/DeviceDetail";
import { DeviceList } from "../components/devices/DeviceList";
import { useAccountDevices } from "../components/devices/queries";
import { internalState } from "../lib/navigation";
import { useBreakpoint } from "../work/shell/useBreakpoint";
import { WorkToolbar } from "../work/ui/WorkToolbar";

/**
 * 工作里的设备页（/work/devices 与 /work/devices/:id）：与「我」里同一个列表和详情组件，
 * 入口不同。这里不提供解绑等账号级管理动作，那些留在「我」。
 */
export function WorkDevices({ accountId }: { accountId: string }) {
	const breakpoint = useBreakpoint();
	const { id } = useParams();
	const loc = useLocation();
	const devices = useAccountDevices(accountId);
	const device = id ? devices.data?.find((item) => item.id === id) : undefined;
	const back = (
		<Link
			to={id ? "/work/devices" : "/work"}
			state={internalState(loc)}
			aria-label="返回"
			className="press grid size-11 shrink-0 place-items-center rounded-full"
		>
			<ArrowLeft size={20} aria-hidden />
		</Link>
	);
	if (!id)
		return (
			<div className="flex h-full flex-col">
				<WorkToolbar phone={breakpoint === "phone"} leading={<Link to="/work">工作</Link>} title="设备" />
				<div className="scroll-y min-h-0 flex-1 px-3 pb-6">
					<div className="overflow-hidden rounded-card bg-raised">
						<DeviceList accountId={accountId} base="/work/devices" />
					</div>
				</div>
			</div>
		);
	if (devices.isPending)
		return (
			<div className="flex h-full flex-col">
				<WorkToolbar phone={breakpoint === "phone"} leading={back} title="设备" />
				<p role="status" className="flex-1 p-6 text-small text-muted">
					正在读取设备…
				</p>
			</div>
		);
	if (!device)
		return (
			<div className="flex h-full flex-col">
				<WorkToolbar phone={breakpoint === "phone"} leading={back} title="设备" />
				<div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-small">
					<p className="text-muted">找不到这台设备，它可能已经解绑。</p>
					<Link to="/work/devices" replace className="text-accent-ink underline">
						返回设备列表
					</Link>
				</div>
			</div>
		);
	return (
		<div className="flex h-full flex-col">
			<WorkToolbar phone={breakpoint === "phone"} leading={back} title={device.name} />
			<div className="scroll-y min-h-0 flex-1 px-3 pb-6">
				<div className="mx-auto max-w-3xl">
					<DeviceDetail device={device} accountId={accountId} workBase="/work/device" />
					<p className="py-4 text-caption text-faint">
						改名与解绑在「我 · 设备」里。
						<Link
							to={`/me/devices/${encodeURIComponent(device.id)}`}
							state={internalState(loc)}
							className="ml-1 underline"
						>
							打开
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}
