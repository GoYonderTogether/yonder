import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc } from "../../api/client";
import { cn } from "../../lib/cn";
import { setNotifyPrefs, usePrefs } from "../../lib/prefs";

type NotifyLevel = "all" | "mentions" | "mute";

/** notifications.prefs.get 的结果（contracts §16）：节点上的合并值 + 每项来源。 */
export interface NotifyPrefsResult {
	default: NotifyLevel;
	conversations: Record<string, NotifyLevel>;
	sources: { default: "yaml" | "runtime"; conversations: Record<string, "yaml" | "runtime"> };
}

const PREFS_KEY = ["notify-prefs"] as const;

/** 网关只存免打扰级别；震动与预览没有对应字段，仍留在本机浏览器。 */
const LOCAL_TOGGLES = [
	{ key: "vibrate", label: "震动", hint: "有通知时震动" },
	{ key: "previews", label: "消息预览", hint: "通知里显示消息内容" },
] as const;

/**
 * 通知分区：全局免打扰（通知开关）读写节点的 notifications.prefs（契约 §16），
 * 改完立即在节点生效、跨设备一致；连不上节点时退回本机浏览器存储。
 * 会话级的全部提醒 / 仅 @ / 免打扰另在消息列表长按或右键设置。
 */
export function NotifySection() {
	const prefs = usePrefs();
	const client = useQueryClient();
	const remote = useQuery({
		queryKey: PREFS_KEY,
		queryFn: () => rpc<NotifyPrefsResult>("notifications.prefs.get", {}),
		retry: false,
	});
	const enabled = remote.data ? remote.data.default !== "mute" : prefs.notify.enabled;
	const save = useMutation({
		mutationFn: (next: boolean) => rpc("notifications.prefs.set", { conv: "*", level: next ? "all" : "mute" }),
		onSuccess: (_ok, next) =>
			client.setQueryData<NotifyPrefsResult>(PREFS_KEY, (old) =>
				old
					? {
							...old,
							default: next ? "all" : "mute",
							sources: { ...old.sources, default: "runtime" },
						}
					: old,
			),
	});
	const toggleEnabled = () => {
		const next = !enabled;
		// 先写本地：其他分区读的是 usePrefs，同时作为无网关时的后备。
		setNotifyPrefs({ enabled: next });
		if (remote.isSuccess) save.mutate(next);
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-notify">
			<h2 className="mb-2 text-body font-medium">通知</h2>
			<div className="flex flex-col gap-1">
				<Toggle
					on={enabled}
					label="通知"
					hint="关闭后不再推送，未读仍然累计"
					onClick={toggleEnabled}
					disabled={save.isPending}
				/>
				{LOCAL_TOGGLES.map(({ key, label, hint }) => (
					<Toggle
						key={key}
						on={prefs.notify[key]}
						label={label}
						hint={hint}
						onClick={() => setNotifyPrefs({ [key]: !prefs.notify[key] })}
					/>
				))}
			</div>
			{remote.isLoading && <p className="mt-2 text-caption text-faint">正在读取节点上的通知偏好…</p>}
			<p className="mt-2 text-caption text-faint">
				{remote.isSuccess
					? "通知开关存在节点上，其他设备同样生效；震动与消息预览只在这台设备。"
					: "还没连上节点，通知开关先记在这台设备，连上后以节点上的设置为准。"}
				会话级的全部提醒 / 仅 @ / 免打扰在消息列表长按或右键设置。
			</p>
			{save.isError && (
				<p className="mt-1 text-caption text-danger">
					保存到节点失败：{save.error instanceof Error ? save.error.message : "未知错误"}
				</p>
			)}
		</section>
	);
}

function Toggle({
	on,
	label,
	hint,
	onClick,
	disabled,
}: {
	on: boolean;
	label: string;
	hint: string;
	onClick(): void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			onClick={onClick}
			disabled={disabled}
			className="press flex items-center justify-between gap-3 rounded-control py-2 text-left"
		>
			<span className="min-w-0">
				<span className="block text-small">{label}</span>
				<span className="block text-caption text-faint">{hint}</span>
			</span>
			<span
				aria-hidden
				className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-accent" : "bg-tone-2")}
			>
				<span
					className={cn(
						"absolute top-0.5 size-5 rounded-full bg-raised transition-[left]",
						on ? "left-[1.125rem]" : "left-0.5",
					)}
				/>
			</span>
		</button>
	);
}
