import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Download, Monitor, RotateCw } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api } from "../api";
import { Page } from "../components/AppBar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { InstallPanel } from "./Download";
import { connectionPrompt } from "./Install";

export function Connect() {
	const code = new URLSearchParams(useLocation().search).get("code") ?? "";
	const nav = useNavigate();
	const [busy, setBusy] = useState(false);
	const { data: device, isError } = useQuery({
		queryKey: ["device-code", code],
		queryFn: () => api.deviceCode(code),
		enabled: !!code,
		retry: false,
	});
	const confirm = async () => {
		setBusy(true);
		try {
			await api.confirmDevice(code);
			toast("已连接");
			nav("/contacts");
		} catch (error) {
			toast(error instanceof Error ? error.message : "连接失败");
			setBusy(false);
		}
	};
	return code ? (
		<Page title="连接设备">
			<div className="flex max-w-sm items-center gap-3 rounded-card bg-tone px-4 py-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-control bg-raised">
					<Monitor size={20} />
				</span>
				<span className="text-body font-medium">{isError ? "授权码无效或已过期" : (device?.name ?? "…")}</span>
			</div>
			<Button
				variant="primary"
				className="self-start"
				onClick={confirm}
				disabled={busy || !device || device.status !== "pending"}
			>
				允许连接
			</Button>
		</Page>
	) : (
		<AddDeviceDialog open onOpenChange={(open) => !open && nav("/contacts")} onConnected={() => nav("/contacts")} />
	);
}

export function AddDeviceDialog({
	open,
	onOpenChange,
	onConnected,
	initialTab = "existing",
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConnected: () => void;
	initialTab?: "existing" | "install";
}) {
	const nav = useNavigate();
	const [tab, setTab] = useState<"existing" | "install">(initialTab);
	const [invite, setInvite] = useState<{ code: string; expiresAt: string }>();
	const [copied, setCopied] = useState(false);
	const [now, setNow] = useState(Date.now());
	const baseline = useRef<Set<string> | null>(null);
	const expiryToasted = useRef(false);
	const connectedOnce = useRef(false);
	const { data: devices, isError: devicesError } = useQuery({
		queryKey: ["devices"],
		queryFn: api.devices,
		enabled: open,
		refetchInterval: open ? 3000 : false,
	});
	const connected = devices?.find((device) => baseline.current?.has(device.id) === false);
	const expired = invite ? Date.parse(invite.expiresAt) <= now : false;

	const generate = async () => {
		baseline.current = new Set((devices ?? []).map((device) => device.id));
		try {
			setInvite(await api.createInvite());
		} catch (error) {
			const message = error instanceof Error ? error.message : "邀请码生成失败";
			toast(/limit|rate|频繁|限制/i.test(message) ? "操作太频繁，请稍后再试" : message);
		}
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在进入页面时生成一次
	useEffect(() => {
		if (open && (devices || devicesError) && !invite) void generate();
	}, [open, devices, devicesError, invite]);
	useEffect(() => {
		if (!open) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [open]);
	useEffect(() => {
		if (!connected || connectedOnce.current) return;
		connectedOnce.current = true;
		toast("已连接");
		onOpenChange(false);
		onConnected();
	}, [connected, onOpenChange, onConnected]);
	useEffect(() => {
		if (expired && !expiryToasted.current) {
			expiryToasted.current = true;
			toast("邀请码已过期，请重新生成");
		}
		if (!expired) expiryToasted.current = false;
	}, [expired]);
	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), 2500);
		return () => window.clearTimeout(timer);
	}, [copied]);
	const prompt = invite ? connectionPrompt(invite.code) : "";
	const remaining = invite ? Math.max(0, Math.ceil((Date.parse(invite.expiresAt) - now) / 1000)) : 0;
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast("已复制");
			setCopied(true);
		} catch {
			toast("复制失败，请长按选中文本复制");
		}
	};

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="fade fixed inset-0 z-40 bg-ink/30" />
				<Dialog.Content className="rise fixed inset-0 z-50 flex flex-col gap-5 overflow-y-auto bg-raised p-5 pb-safe outline-none md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[90dvh] md:w-[min(560px,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-card md:p-7 md:shadow-float">
					<div className="flex items-center gap-3">
						<Dialog.Title className="min-w-0 flex-1 text-title font-semibold tracking-tight">添加设备</Dialog.Title>
						<Button size="sm" className="shrink-0" onClick={() => nav("/download")}>
							<Download size={15} />
							下载客户端
						</Button>
					</div>
					<Dialog.Description className="sr-only">复制提示词连接电脑上的 Yonder，或在本机安装</Dialog.Description>
					<div className="flex gap-2" role="tablist" aria-label="添加设备方式">
						{(
							[
								["existing", "已有设备"],
								["install", "在本机安装"],
							] as const
						).map(([key, label]) => (
							<button
								type="button"
								key={key}
								role="tab"
								aria-selected={tab === key}
								onClick={() => setTab(key)}
								className={`press rounded-full px-4 py-1.5 text-small ${tab === key ? "bg-accent text-on-accent" : "bg-tone text-muted"}`}
							>
								{label}
							</button>
						))}
					</div>
					{tab === "install" ? (
						<InstallPanel />
					) : (
						<>
							<div className="flex items-center gap-4">
								<div
									role="timer"
									aria-label={`邀请码剩余 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`}
									className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tone"
									style={{
										background: `conic-gradient(var(--accent) ${invite ? (remaining / 600) * 100 : 0}%, var(--tone) 0)`,
									}}
								>
									<span className="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-caption font-medium">
										{expired ? "过期" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
									</span>
								</div>
								<div>
									<p className="text-body font-medium">让 Bot 帮我连接</p>
									<p className="text-small text-muted">
										{expired ? "邀请码已过期，请重新生成" : "把下面提示词发给电脑上的 Bot，正在等待连接"}
									</p>
								</div>
							</div>
							<div className="relative">
								<pre
									// biome-ignore lint/a11y/noNoninteractiveTabindex: 可滚动的代码块需要键盘可达
									tabIndex={0}
									className="max-h-[34dvh] select-text overflow-auto whitespace-pre-wrap rounded-control bg-ink p-4 pr-12 font-mono text-caption leading-relaxed text-ground"
								>
									{prompt || "正在生成邀请码…"}
								</pre>
								<Button
									variant="ghost"
									size="icon-sm"
									title="复制提示词"
									aria-label="复制提示词"
									className="absolute top-2 right-2 text-ground/70 hover:bg-ground/10 hover:text-ground"
									disabled={!prompt || expired}
									onClick={() => void copy(prompt)}
								>
									{copied ? <Check size={14} className="pop" /> : <Copy size={15} />}
								</Button>
							</div>
							{expired && (
								<Button className="self-start" onClick={() => void generate()}>
									<RotateCw size={15} />
									重新生成
								</Button>
							)}
							<details className="rounded-control bg-tone px-4 py-3">
								<summary className="cursor-pointer text-small font-medium">其他方式</summary>
								<div className="mt-3 flex flex-col gap-3">
									<div className="flex items-center gap-2">
										<code className="min-w-0 flex-1 break-all text-small">
											yonder channels login card --verify-code {invite?.code ?? "__________"}
										</code>
										<Button
											size="sm"
											disabled={!invite || expired}
											onClick={() => invite && void copy(`yonder channels login card --verify-code ${invite.code}`)}
										>
											复制命令
										</Button>
									</div>
									<Link to="/get" className="text-small underline underline-offset-4">
										前往安装页
									</Link>
								</div>
							</details>
						</>
					)}
					<Dialog.Close asChild>
						<Button variant="ghost" className="self-end">
							关闭
						</Button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
