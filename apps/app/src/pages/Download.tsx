import { ArrowLeft, Check, Copy, Download as DownloadIcon, Monitor, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAppBack } from "../lib/navigation";
import { detectPlatform, type InstallTarget, installTarget, type Platform, platformName } from "../lib/platform";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";

const currentPlatform = (): Platform =>
	typeof navigator === "undefined" ? "other" : detectPlatform(navigator.userAgent, navigator.platform);

/** 复制成功由按钮自己的对勾反馈（2.5 秒自熄），不再弹提示；失败只提示，不抛。 */
const copyText = async (text: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		toast("复制失败，请长按选中文本复制");
		return false;
	}
};

/** 命令块：与添加设备弹窗的提示词块同一套样式，复制图标在右上角。 */
export function CommandBlock({ command, label }: { command: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	return (
		<div className="relative">
			<pre
				// biome-ignore lint/a11y/noNoninteractiveTabindex: 可滚动的代码块需要键盘可达
				tabIndex={0}
				className="select-text overflow-auto break-all whitespace-pre-wrap rounded-control bg-code-bg p-4 pr-12 font-mono text-caption leading-relaxed text-code-ink"
			>
				{command}
			</pre>
			<Button
				variant="ghost"
				size="icon-sm"
				title={label}
				aria-label={label}
				className="absolute top-2 right-2 text-code-ink/70 hover:bg-code-ink/10 hover:text-code-ink"
				onClick={() => {
					void copyText(command).then((ok) => ok && setCopied(true));
				}}
			>
				{copied ? <Check size={14} className="pop" /> : <Copy size={15} />}
			</Button>
		</div>
	);
}

const STEPS: Record<"macos" | "linux" | "windows", string[]> = {
	macos: ["把命令粘贴到「终端」回车", "首次安装需要几分钟构建", "完成后按提示登录模型供应商"],
	linux: ["把命令粘贴到终端回车", "首次安装需要几分钟构建", "完成后按提示登录模型供应商"],
	windows: ["以普通用户打开「PowerShell」", "把命令粘贴进去回车", "完成后按提示登录模型供应商"],
};

const DESKTOP_STEPS: Record<"macos" | "windows", string[]> = {
	macos: ["桌面安装包装到「应用程序」，并去掉下载隔离标记", "同时把核心装成后台服务，关掉窗口后继续运行"],
	windows: ["桌面安装包静默安装到开始菜单", "同时把核心装成登录时自启的后台任务"],
};

function ChoosePlatform({ onPick }: { onPick: (platform: Platform) => void }) {
	return (
		<div className="flex flex-col gap-3">
			<p className="text-small text-muted">没认出当前系统，选择要安装到哪台电脑：</p>
			<div className="flex flex-wrap gap-2">
				{(["macos", "windows", "linux"] as const).map((platform) => (
					<Button key={platform} size="sm" onClick={() => onPick(platform)}>
						{platformName[platform]}
					</Button>
				))}
			</div>
		</div>
	);
}

function TargetBody({ target, onPick }: { target: InstallTarget; onPick: (platform: Platform) => void }) {
	if (target.kind === "choose") return <ChoosePlatform onPick={onPick} />;
	if (target.kind === "client")
		return (
			<div className="flex flex-col gap-3">
				<p className="text-small text-muted">
					手机上不用装桌面端，直接用浏览器打开本页即可。想要桌面图标，可以下载客户端或添加到主屏幕。
				</p>
				<a
					href={target.href}
					target="_blank"
					rel="noreferrer"
					className="press inline-flex h-10 w-fit items-center gap-1.5 rounded-full bg-accent px-4 text-small font-medium text-on-accent hover:opacity-90"
				>
					<DownloadIcon size={15} />
					{target.platform === "android" ? "下载安卓客户端" : "参加 iOS TestFlight"}
				</a>
				<p className="text-caption text-faint">
					{target.platform === "android"
						? "也可在 Chrome 菜单里选择「安装应用」"
						: "也可在 Safari 分享菜单里选择「添加到主屏幕」"}
				</p>
			</div>
		);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<p className="text-small font-medium">只装核心（命令行与终端界面）</p>
				<CommandBlock command={target.command} label={`复制 ${target.label} 安装命令`} />
			</div>
			{target.desktop ? (
				<div className="flex flex-col gap-2">
					<p className="text-small font-medium">{target.desktop.label}</p>
					<CommandBlock command={target.desktop.command} label={`复制 ${target.label} 桌面应用安装命令`} />
					<p className="text-caption text-faint">{target.desktop.note}</p>
					<ol className="flex list-decimal flex-col gap-1 pl-5 text-small text-muted">
						{DESKTOP_STEPS[target.platform as "macos" | "windows"].map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
				</div>
			) : null}
			<ol className="flex list-decimal flex-col gap-1 pl-5 text-small text-muted">
				{STEPS[target.platform as "macos" | "linux" | "windows"].map((step) => (
					<li key={step}>{step}</li>
				))}
			</ol>
		</div>
	);
}

/** 面板副标题：只说这一种系统实际能装什么，不承诺没有的产物。 */
function panelSubtitle(target: InstallTarget): string {
	if (target.kind === "client") return "浏览器就能用，也可以装成桌面图标";
	if (target.kind === "choose") return "选好系统后给出安装命令";
	return target.desktop ? "两段命令二选一：只装核心，或核心 + 桌面应用" : "一段命令装好本机核心，并初始化数据目录";
}

/** 统一安装页：免登录可看；已登录的人从这里回应用。 */
export function InstallPanel() {
	const [picked, setPicked] = useState<Platform>();
	const platform = picked ?? currentPlatform();
	const target = installTarget(platform);
	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center gap-4">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-tone">
					{target.kind === "client" ? <Smartphone size={22} /> : <Monitor size={22} />}
				</span>
				<div>
					<p className="text-body font-medium">{target.kind === "client" ? "手机端" : platformName[platform]}</p>
					<p className="text-small text-muted">{panelSubtitle(target)}</p>
				</div>
			</div>
			<TargetBody target={target} onPick={setPicked} />
			<p className="text-small text-muted">
				装好后回到「添加设备」→「已有设备」，把提示词发给这台机器上的 Bot，即可完成连接。
			</p>
		</div>
	);
}

export function Download() {
	const back = useAppBack("/");
	return (
		<div className="scroll-y h-full full-top-safe">
			<div className="mx-auto max-w-2xl px-4 pt-10 pb-16 md:px-6 md:pt-20">
				<button
					type="button"
					className="press mb-6 inline-flex items-center gap-1.5 text-small text-muted hover:text-ink"
					onClick={back}
				>
					<ArrowLeft size={16} />
					返回
				</button>
				<h1 className="display rise">下载 Yonder</h1>
				<p className="mt-2 text-body text-muted">
					电脑装本机核心，需要桌面应用时再选「核心 + 桌面应用」；手机用浏览器即可。装好后回到网页添加设备。
				</p>
				<div className="rise mt-8">
					<InstallPanel />
				</div>
				<div className="mt-10 flex flex-wrap gap-4 text-small text-muted">
					<Link to="/connect" className="underline underline-offset-4 hover:text-ink">
						添加设备
					</Link>
					<Link to="/get" className="underline underline-offset-4 hover:text-ink">
						连接提示词
					</Link>
				</div>
			</div>
		</div>
	);
}
