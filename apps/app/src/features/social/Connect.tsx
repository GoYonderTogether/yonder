import { useQuery } from "@tanstack/react-query";
import { Copy, Monitor, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { connectionPrompt } from "./Install";

const contacts = href({ tab: "contacts" });

export function Connect() {
	const code =
		new URLSearchParams(location.search).get("code") ??
		new URLSearchParams(location.hash.split("?")[1]).get("code") ??
		"";
	const [invite, setInvite] = useState<{ code: string; expiresAt: string }>();
	const [step, setStep] = useState(1);
	const [inviteError, setInviteError] = useState(false);
	const [now, setNow] = useState(Date.now());
	const [busy, setBusy] = useState(false);
	const baseline = useRef<Set<string> | null>(null);
	const device = useQuery({
		queryKey: ["device-code", code],
		queryFn: () => httpApi.deviceCode(code),
		enabled: !!code,
		retry: false,
		retryOnMount: false,
	});
	const devices = useQuery({
		queryKey: ["devices"],
		queryFn: httpApi.devices,
		enabled: !code,
		refetchInterval: code ? false : 3000,
		retry: false,
	});
	const connected = devices.data?.find((item) => baseline.current?.has(item.id) === false);
	const expired = invite ? Date.parse(invite.expiresAt) <= now : false;
	const remaining = invite ? Math.max(0, Math.ceil((Date.parse(invite.expiresAt) - now) / 1000)) : 0;
	const prompt = invite ? connectionPrompt(invite.code) : "";
	const generate = useCallback(async () => {
		baseline.current = new Set((devices.data ?? []).map((item) => item.id));
		setInviteError(false);
		try {
			setInvite(await httpApi.createInvite());
			setStep(1);
		} catch (error) {
			setInviteError(true);
			toast(error instanceof Error ? error.message : "邀请码生成失败", true);
		}
	}, [devices.data]);
	useEffect(() => {
		if (!code && devices.data && !invite && !baseline.current) void generate();
	}, [code, devices.data, invite, generate]);
	useEffect(() => {
		if (code) return;
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [code]);
	const copy = async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			toast("已复制");
		} catch {
			toast("复制失败，请长按选中文本复制", true);
		}
	};
	const confirm = async () => {
		setBusy(true);
		try {
			await httpApi.confirmDevice(code);
			toast("已连接");
			location.hash = contacts;
		} catch (error) {
			toast(error instanceof Error ? error.message : "连接失败", true);
			setBusy(false);
		}
	};
	return (
		<main className="mx-auto flex h-full w-full max-w-xl flex-col gap-5 overflow-y-auto bg-raised p-5 md:p-7">
			<h1 className="text-title font-semibold tracking-tight">{code ? "连接设备" : "添加设备"}</h1>
			{code ? (
				<>
					<div className="flex max-w-sm items-center gap-3 rounded-card bg-tone px-4 py-3">
						<span className="flex h-10 w-10 items-center justify-center rounded-control bg-raised">
							<Monitor size={20} />
						</span>
						<span className="text-body font-medium">
							{device.isError ? "授权码无效或已过期" : (device.data?.name ?? "正在加载…")}
						</span>
					</div>
					<Button
						variant="primary"
						className="self-start"
						onClick={() => void confirm()}
						disabled={busy || !device.data || device.data.status !== "pending"}
					>
						允许连接
					</Button>
				</>
			) : connected ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
					<span className="flex h-16 w-16 items-center justify-center rounded-full bg-tone">
						<Monitor size={28} />
					</span>
					<p className="text-title font-semibold">{connected.name} 已连接</p>
					<a href={contacts} className="rounded-full bg-accent px-4 py-2 text-on-accent">
						去联系人
					</a>
				</div>
			) : (
				<>
					<div className="flex items-center gap-2 text-caption text-muted">
						<span className={step === 1 ? "font-semibold text-ink" : ""}>1 · 复制提示词</span>
						<span className="h-px flex-1 bg-tone-2" />
						<span className={step === 2 ? "font-semibold text-ink" : ""}>2 · 等待连接</span>
					</div>
					{devices.isError ? (
						<div role="alert">
							设备列表加载失败 <Button onClick={() => void devices.refetch()}>重试</Button>
						</div>
					) : step === 1 ? (
						<>
							<div className="flex items-center gap-4">
								<div
									role="timer"
									aria-label={`邀请码剩余 ${Math.floor(remaining / 60)} 分 ${remaining % 60} 秒`}
									className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-tone text-caption"
								>
									{expired ? "过期" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}
								</div>
								<div>
									<p className="text-body font-medium">让 Agent 帮我连接</p>
									<p className="text-small text-muted">把下面提示词发给电脑上的 Agent</p>
								</div>
							</div>
							<pre className="max-h-[34dvh] select-text overflow-auto whitespace-pre-wrap rounded-control bg-ink p-4 font-mono text-caption leading-relaxed text-ground">
								{prompt || (inviteError ? "邀请码生成失败，请重试" : "正在生成邀请码…")}
							</pre>
							<Button
								variant="primary"
								className="h-12 w-full"
								disabled={!prompt || expired}
								onClick={() => void copy(prompt)}
							>
								<Copy size={16} />
								复制提示词
							</Button>
							{(expired || inviteError) && (
								<Button onClick={() => void generate()}>
									<RotateCw size={15} />
									重新生成
								</Button>
							)}
							<Button onClick={() => setStep(2)} disabled={!invite}>
								我已发送，等待连接
							</Button>
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
									<a href={href({ tab: "chats", page: "get" })} className="text-small underline underline-offset-4">
										前往安装页
									</a>
								</div>
							</details>
						</>
					) : (
						<div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
							<p className="text-title font-semibold">等待设备连接</p>
							<p className="text-small text-muted">连接成功后会自动显示设备</p>
							{expired && (
								<>
									<p className="text-small text-danger">邀请码已过期</p>
									<Button variant="primary" onClick={() => void generate()}>
										<RotateCw size={15} />
										重新生成
									</Button>
								</>
							)}
							<Button variant="ghost" onClick={() => setStep(1)}>
								返回提示词
							</Button>
						</div>
					)}
				</>
			)}
			<a href={contacts} className="self-end text-small underline underline-offset-4">
				关闭
			</a>
		</main>
	);
}
