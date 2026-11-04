import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";

/**
 * 接入已有 Bot（research/04 §4 流程 5）：把外部 harness 的 agent 作为一台 `kind='harness'` 设备接入。
 * 现在只有 DSH 有定义好的连接器命令（plan D3）；别的框架还没实现，因此不列。
 */
export const CONNECT_COMMANDS = [{ id: "dsh", label: "DSH", command: "npx -y @yonder/connect dsh" }] as const;

/**
 * 打开后才出现的 `kind='harness'` 设备才算「刚接入」。已存在的、或不是 harness 的设备都不算，
 * 否则开一次对话框就会误跳到别人的设备上。
 */
export function freshHarnessDevice(
	devices: readonly { id: string; kind: string }[] | undefined,
	baseline: ReadonlySet<string> | null,
): string | undefined {
	if (!devices || !baseline) return undefined;
	return devices.find((device) => device.kind === "harness" && !baseline.has(device.id))?.id;
}

export function ConnectBotDialog({
	open,
	onOpenChange,
	onConnected,
}: {
	open: boolean;
	onOpenChange: (v: boolean) => void;
	onConnected: () => void;
}) {
	const nav = useNavigate();
	const [copied, setCopied] = useState<string | null>(null);
	// 打开前的设备集：只有打开之后新出现的 harness 设备才算「刚接入」。
	const baseline = useRef<Set<string> | null>(null);
	const landed = useRef(false);
	const devices = useQuery({
		queryKey: ["devices"],
		queryFn: api.devices,
		enabled: open,
		refetchInterval: open ? 3000 : false,
	});
	const connected = freshHarnessDevice(devices.data, baseline.current);
	useEffect(() => {
		if (!open) {
			baseline.current = null;
			landed.current = false;
			return;
		}
		if (!baseline.current) baseline.current = new Set((devices.data ?? []).map((device) => device.id));
	}, [open, devices.data]);
	useEffect(() => {
		if (!connected || landed.current) return;
		landed.current = true;
		toast("已接入");
		onOpenChange(false);
		onConnected();
		nav(`/me/devices/${encodeURIComponent(connected)}`);
	}, [connected, nav, onConnected, onOpenChange]);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(null), 2500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	const copy = async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(command);
		} catch {
			toast("复制失败，请长按选中文本复制", true);
		}
	};
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-ink/30" />
				<Dialog.Content className="rise fixed inset-x-0 bottom-0 z-50 flex max-h-[85%] flex-col gap-4 rounded-t-panel bg-raised p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-float outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel">
					<Dialog.Title className="text-title font-semibold tracking-tight">接入已有 Bot</Dialog.Title>
					<Dialog.Description className="text-small text-muted">
						在已有 agent 的电脑上执行这条命令，装好的连接器会把这台机器登记为一台设备，它的 Bot
						会出现在你的联系人里。命令只装连接器、写它自己的状态目录，不改 PATH、不装全局命令。
					</Dialog.Description>
					{CONNECT_COMMANDS.map((item) => (
						<div key={item.id}>
							<p className="mb-1 text-small font-medium">{item.label}</p>
							<div className="relative">
								<pre
									// biome-ignore lint/a11y/noNoninteractiveTabindex: 可滚动的代码块需要键盘可达
									tabIndex={0}
									className="select-text overflow-x-auto rounded-control bg-code-bg p-3 pr-12 font-mono text-caption text-code-ink"
								>
									{item.command}
								</pre>
								<Button
									variant="ghost"
									size="icon-sm"
									title="复制命令"
									aria-label={`复制 ${item.label} 命令`}
									className="absolute top-1.5 right-1.5 text-code-ink/70 hover:bg-code-ink/10 hover:text-code-ink"
									onClick={() => void copy(item.command)}
								>
									{copied === item.command ? <Check size={14} className="pop" /> : <Copy size={15} />}
								</Button>
							</div>
						</div>
					))}
					<p role="status" className="text-small text-muted">
						{devices.isError
							? "无法读取设备，接入结果需要刷新后确认。"
							: connected
								? "已接入，正在打开这台设备…"
								: "执行后请保持这个窗口打开，新设备出现时会自动打开它。"}
					</p>
					<div className="flex justify-end">
						<Dialog.Close asChild>
							<Button variant="ghost">关闭</Button>
						</Dialog.Close>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
