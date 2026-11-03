import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";
import { useBotDevices, useDeviceGrants, useSetBotDevices } from "./queries";
import { BOT_DEVICE_WORD, botDeviceState, DEVICE_KIND_WORD, relativeTime } from "./state";

/**
 * Bot 的「可操作的设备」（research/04 §4 流程 3，spec 19 §9）。
 * 允许表只决定这个 Bot 可以向哪些设备发起；实际执行还要通过设备上的 grant，两者分开显示。
 */
export function BotDevices({ botId }: { botId: string }) {
	const scope = useBotDevices(botId);
	const save = useSetBotDevices(botId);
	const [editing, setEditing] = useState(false);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [busy, setBusy] = useState(false);
	if (scope.isPending)
		return (
			<p role="status" className="px-4 py-3 text-small text-muted">
				正在读取可操作设备…
			</p>
		);
	if (scope.isError)
		return (
			<p role="alert" className="px-4 py-3 text-small text-danger">
				无法读取可操作设备：{scope.error.message}
			</p>
		);
	const data = scope.data;
	if (!data.devices.length)
		return <p className="px-4 py-3 text-small text-muted">未绑定设备。添加设备后，Bot 才能操作其他电脑。</p>;
	const allowed = new Set(data.allowed);
	const begin = () => {
		setPicked(new Set(data.allowed));
		setEditing(true);
	};
	const write = async (input: { mode: "all" } | { mode: "selected"; devices: string[] }) => {
		if (busy) return;
		setBusy(true);
		try {
			await save(input);
			setEditing(false);
			toast(input.mode === "all" ? "已允许全部设备" : "已更新可操作设备");
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="px-4 py-3">
			<div className="flex items-baseline gap-2">
				<p className="min-w-0 flex-1 text-small">
					{data.mode === "all" ? "全部设备" : allowed.size ? `已收窄到 ${allowed.size} 台设备` : "不允许任何设备"}
				</p>
				{!editing && (
					<Button size="sm" onClick={begin}>
						{data.mode === "all" ? "收窄" : "修改"}
					</Button>
				)}
			</div>
			<ul className="mt-2 divide-y divide-hairline/60">
				{(editing ? data.devices : data.devices.filter((device) => allowed.has(device.id))).map((device) => (
					<li key={device.id} className="py-2">
						<div className="flex items-center gap-3">
							{editing && (
								<input
									type="checkbox"
									className="size-4 shrink-0"
									aria-label={`允许 ${device.name}`}
									checked={picked.has(device.id)}
									onChange={(event) => {
										const next = new Set(picked);
										if (event.target.checked) next.add(device.id);
										else next.delete(device.id);
										setPicked(next);
									}}
								/>
							)}
							<span className="min-w-0 flex-1 text-small">
								{device.name}
								<span className="ml-2 text-caption text-faint">{DEVICE_KIND_WORD[device.kind]}</span>
							</span>
							{editing ? (
								<span className="shrink-0 text-caption text-faint">{device.online ? "在线" : "离线"}</span>
							) : (
								<DeviceTruth botId={botId} deviceId={device.id} allowed online={device.online} />
							)}
						</div>
					</li>
				))}
			</ul>
			{editing && (
				<div className="mt-3 flex flex-wrap gap-2">
					<Button
						size="sm"
						variant="primary"
						disabled={busy}
						onClick={() => void write({ mode: "selected", devices: [...picked] })}
					>
						{picked.size ? "只允许选中的设备" : "不允许任何设备"}
					</Button>
					<Button size="sm" disabled={busy} onClick={() => void write({ mode: "all" })}>
						允许全部设备
					</Button>
					<Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
						取消
					</Button>
				</div>
			)}
			<p className="mt-2 text-caption text-faint">
				这里只决定这个 Bot 可以向哪些设备发起；实际执行仍要设备上的授权（grant）放行。
			</p>
		</div>
	);
}

/** 每台设备的真实状态：未允许 / 设备离线 / 设备未上报授权 / 无 grant / 可执行。 */
function DeviceTruth({
	botId,
	deviceId,
	allowed,
	online,
}: {
	botId: string;
	deviceId: string;
	allowed: boolean;
	online: boolean;
}) {
	const grants = useDeviceGrants(deviceId);
	const state = grants.data
		? botDeviceState({
				allowed,
				online,
				observed: grants.data.observed,
				hasGrant: grants.data.grants.some((grant) => grant.botId === botId && !grant.revokedAt),
			})
		: undefined;
	const word = state ? BOT_DEVICE_WORD[state] : "读取授权…";
	const grant = grants.data?.grants.find((item) => item.botId === botId && !item.revokedAt);
	return (
		<span
			className={cn(
				"shrink-0 text-caption",
				state === "ready" ? "text-accent-ink" : state === "not-allowed" ? "text-faint" : "text-muted",
			)}
			title={grant ? `第 ${grant.revision} 版 · ${relativeTime(grant.issuedAt) ?? ""}` : undefined}
		>
			{word}
		</span>
	);
}
