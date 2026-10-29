import { cn } from "../../lib/cn";
import { setNotifyPrefs, usePrefs } from "../../lib/prefs";

const TOGGLES = [
	{ key: "enabled", label: "通知", hint: "关闭后不再推送，未读仍然累计" },
	{ key: "vibrate", label: "震动", hint: "有通知时震动" },
	{ key: "previews", label: "消息预览", hint: "通知里显示消息内容" },
] as const;

/** 通知分区：全局偏好，存本机浏览器（lib/prefs.ts），与每个会话的免打扰分级叠加。 */
export function NotifySection() {
	const prefs = usePrefs();
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-notify">
			<h2 className="mb-2 text-body font-medium">通知</h2>
			<div className="flex flex-col gap-1">
				{TOGGLES.map(({ key, label, hint }) => {
					const on = prefs.notify[key];
					return (
						<button
							key={key}
							type="button"
							role="switch"
							aria-checked={on}
							onClick={() => setNotifyPrefs({ [key]: !on })}
							className="press flex items-center justify-between gap-3 rounded-control py-2 text-left"
						>
							<span className="min-w-0">
								<span className="block text-small">{label}</span>
								<span className="block text-caption text-faint">{hint}</span>
							</span>
							<span
								aria-hidden
								className={cn(
									"relative h-6 w-10 shrink-0 rounded-full transition-colors",
									on ? "bg-accent" : "bg-tone-2",
								)}
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
				})}
			</div>
			<p className="mt-2 text-caption text-faint">
				会话级的全部提醒 / 仅 @ / 免打扰在消息列表长按或右键设置；这些偏好只保存在这台设备的浏览器里。
			</p>
		</section>
	);
}
