import { useQueryClient } from "@tanstack/react-query";
import { Dices } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { pickBotName, uiLanguage } from "../lib/botNames";
import {
	hasNativeShell,
	type NativePermissionKind,
	type NativePermissionResult,
	requestNativePermission,
} from "../lib/nativePermissions";
import { uploadMarketImage } from "../lib/uploadImage";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";
import { AvatarPicker, pickedAvatarUri } from "./AvatarPicker";

/**
 * 首次引导：只在账号还没有自己的 Bot 时出现（PersonalAgentGate 判定），
 * 一屏一步：名字 → 授权（仅 iOS 壳，插件没接好整步跳过）→ 创建 Bot。
 * 走完建好 Bot、开好私聊就结束；不造欢迎语，平台之后会发真的。
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
	// 一屏一步：0 = 名字；1 = 授权（只在带 Tauri 内核的客户端壳里出现）；最后一步 = 创建 Bot。
	const [step, setStep] = useState(0);
	const qc = useQueryClient();
	// 授权步只在客户端壳里出现；web 与桌面壳整步跳过。
	const permissionStep = hasNativeShell();
	const botStep = permissionStep ? 2 : 1;
	const finish = async (botId: string) => {
		try {
			await api.openDm(botId);
		} catch {
			/* 私聊开不了也不拦完成：Bot 已建好，会话可以从联系人进。 */
		}
		await Promise.all([
			qc.invalidateQueries({ queryKey: ["contacts"] }),
			qc.invalidateQueries({ queryKey: ["convs"] }),
		]);
		onDone();
	};
	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			{step === 0 && <NameStep onNext={() => setStep(botStep)} />}
			{step === 1 && permissionStep && (
				<PermissionStep
					onNext={() => setStep(botStep)}
					onSkip={() => setStep(botStep)}
					request={requestNativePermission}
				/>
			)}
			{step === botStep && <BotStep onCreated={(botId) => void finish(botId)} />}
		</div>
	);
}

function NameStep({ onNext }: { onNext: () => void }) {
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const save = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		try {
			await api.updateProfile({ name: name.trim() });
			onNext();
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
			setBusy(false);
		}
	};
	return (
		<form
			className="flex w-full max-w-xs flex-col gap-5"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<h1 className="text-title font-semibold tracking-tight">你的名字</h1>
			<Field label="名字" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
			<Button variant="primary" type="submit" disabled={!name.trim() || busy}>
				下一步
			</Button>
		</form>
	);
}

const PERMISSIONS: { kind: NativePermissionKind; label: string }[] = [
	{ kind: "health", label: "健康" },
	{ kind: "calendar", label: "日历" },
];

function PermissionStep({
	onNext,
	onSkip,
	request,
}: {
	onNext: () => void;
	onSkip: () => void;
	request: (kind: NativePermissionKind) => Promise<NativePermissionResult>;
}) {
	const [results, setResults] = useState<Partial<Record<NativePermissionKind, NativePermissionResult>>>({});
	const requestOne = async (kind: NativePermissionKind) => {
		const result = await request(kind);
		setResults((old) => ({ ...old, [kind]: result }));
	};
	return (
		<div className="flex w-full max-w-xs flex-col gap-5">
			<h1 className="text-title font-semibold tracking-tight">授权</h1>
			<div className="flex flex-col gap-2">
				{PERMISSIONS.map(({ kind, label }) => {
					const result = results[kind];
					return (
						<div key={kind} className="flex items-center justify-between rounded-control bg-tone px-4 py-3">
							<span className="text-small text-ink">{label}</span>
							{result ? (
								<span className="text-small text-muted">
									{result.state === "granted"
										? "已授权"
										: result.state === "denied"
											? "已拒绝"
											: result.state === "prompt"
												? "未决定"
												: "不可用"}
								</span>
							) : (
								<button
									type="button"
									aria-label={`授权${label}`}
									className="press flex h-8 w-8 items-center justify-center rounded-full bg-raised text-small font-medium text-ink shadow-soft"
									onClick={() => void requestOne(kind)}
								>
									＋
								</button>
							)}
						</div>
					);
				})}
			</div>
			<div className="flex gap-2">
				<Button variant="primary" onClick={onNext}>
					下一步
				</Button>
				<Button variant="ghost" onClick={onSkip}>
					跳过
				</Button>
			</div>
		</div>
	);
}

function BotStep({ onCreated }: { onCreated: (botId: string) => void }) {
	const lang = uiLanguage();
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<{ style: string; seed: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const create = async () => {
		if (!name.trim() || busy) return;
		setBusy(true);
		try {
			// 选中了头像就走既有图片上传通道换成托管 URL；上传失败不拦创建。
			let avatarUrl: string | undefined;
			const uri = pickedAvatarUri(picked);
			if (uri) {
				const blob = await (await fetch(uri)).blob();
				avatarUrl = await uploadMarketImage(new File([blob], "avatar.svg", { type: "image/svg+xml" }), () => {});
			}
			const bot = await api.createBot({ name: name.trim(), ...(avatarUrl ? { avatarUrl } : {}) });
			await onCreated(bot.id);
		} catch (error) {
			toast(error instanceof Error ? error.message : "创建失败", true);
			setBusy(false);
		}
	};
	return (
		<form
			className="flex w-full max-w-sm flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				void create();
			}}
		>
			<h1 className="text-title font-semibold tracking-tight">创建你的 bot</h1>
			<div className="flex items-end gap-2">
				<div className="min-w-0 flex-1">
					<Field label="名字" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
				</div>
				<button
					type="button"
					aria-label="随机名字"
					title="随机名字"
					className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-tone text-muted hover:text-ink"
					onClick={() => setName(pickBotName(lang))}
				>
					<Dices size={18} aria-hidden />
				</button>
			</div>
			<AvatarPicker value={picked} onChange={setPicked} />
			<Button variant="primary" type="submit" disabled={!name.trim() || busy}>
				创建
			</Button>
		</form>
	);
}
