import { useState } from "react";
import { type Device, httpApi } from "../../api/social";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
import { toast } from "../../ui/kit/Toast";
import { Window } from "../../ui/kit/Window";
export function Switch({ on, onChange, label }: { on: boolean; onChange: (value: boolean) => void; label: string }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={label}
			onClick={() => onChange(!on)}
			className={`press relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-tone-2"}`}
		>
			<span
				className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-raised shadow-sm transition-transform ${on ? "translate-x-4" : ""}`}
			/>
		</button>
	);
}
export function DeviceSheet({
	device,
	agents,
	open,
	onOpenChange,
	onChanged,
}: {
	device: Device;
	agents: number;
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onChanged: () => void;
}) {
	const [name, setName] = useState(device.name);
	const [online, setOnline] = useState(device.online);
	const save = async () => {
		try {
			await httpApi.renameDevice(device.id, name.trim());
			toast("已改名");
			onChanged();
		} catch (e) {
			toast(e instanceof Error ? e.message : "改名失败", true);
		}
	};
	const power = async (v: boolean) => {
		try {
			await httpApi.setDeviceOnline(device.id, v);
			setOnline(v);
			onChanged();
		} catch (e) {
			toast(e instanceof Error ? e.message : "更新失败", true);
		}
	};
	return (
		<Window open={open} onOpenChange={onOpenChange} title="设备">
			<div className="flex flex-col gap-5 p-5">
				{device.code && <p className="select-text text-small text-muted">设备 ID · {device.code}</p>}
				<Field label="名称" value={name} onChange={(e) => setName(e.target.value)} />
				<div className="flex items-center justify-between rounded-card bg-tone px-4 py-3">
					<span className="text-body">
						联网<span className="ml-2 text-[13px] text-muted">{agents} 个 Agent</span>
					</span>
					<Switch on={online} onChange={(v) => void power(v)} label="这台设备联网" />
				</div>
				<div className="flex gap-2">
					<Button variant="primary" disabled={!name.trim() || name.trim() === device.name} onClick={() => void save()}>
						保存
					</Button>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						关闭
					</Button>
				</div>
			</div>
		</Window>
	);
}
