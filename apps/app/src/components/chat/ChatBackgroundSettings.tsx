import { ImagePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	BACKGROUND_PRESETS,
	type ChatBackground,
	DEFAULT_CHAT_BACKGROUND,
	saveChatBackground,
	useBackgroundPreview,
	useChatBackground,
	validateBackgroundImage,
} from "../../lib/chatBackground";
import { Button } from "../../ui/Button";

type BackgroundSettingsProps = {
	accountId: string | undefined;
	convId: string;
	busy: boolean;
	onBusyChange: (busy: boolean) => void;
	onApplied: () => void;
};
export function ChatBackgroundSettings(props: BackgroundSettingsProps) {
	return <BackgroundEditor key={JSON.stringify([props.accountId, props.convId])} {...props} />;
}
function BackgroundEditor({
	accountId,
	convId,
	busy,
	onBusyChange,
	onApplied,
}: {
	accountId: string | undefined;
	convId: string;
	busy: boolean;
	onBusyChange: (busy: boolean) => void;
	onApplied: () => void;
}) {
	const saved = useChatBackground(accountId, convId);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const [draft, setDraft] = useState<ChatBackground | null>(null),
		[error, setError] = useState("");
	const fileInput = useRef<HTMLInputElement>(null);
	const selected = draft ?? saved.value;
	const style = useBackgroundPreview(selected);
	const disabled = busy || saved.loading || !accountId;
	async function apply() {
		if (disabled || (saved.error && draft === null)) return;
		onBusyChange(true);
		setError("");
		try {
			await saveChatBackground(accountId as string, convId, selected);
			if (alive.current) onApplied();
		} catch (error) {
			if (alive.current) setError(error instanceof Error ? error.message : "背景保存失败，请重试");
		} finally {
			if (alive.current) onBusyChange(false);
		}
	}
	return (
		<section className="flex flex-col gap-5 p-4">
			<p className="text-caption text-muted">仅你可见，保存在当前浏览器。</p>
			<div
				role="img"
				aria-label="聊天背景预览"
				style={style}
				className="flex h-48 items-center justify-center overflow-hidden rounded-card bg-ground ring-1 ring-hairline"
			>
				<span className="rounded-full bg-raised/90 px-3 py-1.5 text-caption text-muted">预览</span>
			</div>
			<fieldset disabled={disabled} className="grid grid-cols-4 gap-2" aria-label="选择背景">
				{BACKGROUND_PRESETS.map((preset) => (
					<label
						key={preset.id}
						className={`press relative flex cursor-pointer flex-col gap-2 rounded-control p-1 text-center text-caption ${selected.kind === "preset" && selected.preset === preset.id ? "ring-2 ring-accent" : "ring-1 ring-hairline"}`}
					>
						<input
							type="radio"
							name="chat-background"
							className="sr-only"
							value={preset.id}
							checked={selected.kind === "preset" && selected.preset === preset.id}
							onChange={() => {
								setDraft({ kind: "preset", preset: preset.id });
								setError("");
							}}
						/>
						<span className="h-12 w-full rounded-control bg-ground" style={{ backgroundColor: preset.color }} />
						<span>{preset.label}</span>
					</label>
				))}
			</fieldset>
			<Button disabled={disabled} onClick={() => fileInput.current?.click()}>
				<ImagePlus size={17} />
				{selected.kind === "image" ? "更换照片" : "从相册选择"}
			</Button>
			<input
				hidden
				ref={fileInput}
				aria-label="选择私人背景照片"
				type="file"
				accept="image/jpeg,image/png,image/webp"
				disabled={disabled}
				onChange={async (event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (!file) return;
					onBusyChange(true);
					setError("");
					try {
						await validateBackgroundImage(file);
						if (alive.current) setDraft({ kind: "image", image: file });
					} catch (error) {
						if (alive.current) setError(error instanceof Error ? error.message : "图片无法读取");
					} finally {
						if (alive.current) onBusyChange(false);
					}
				}}
			/>
			{selected.kind === "image" && (
				<Button
					disabled={disabled}
					onClick={() => {
						setDraft(DEFAULT_CHAT_BACKGROUND);
						setError("");
					}}
				>
					恢复默认背景
				</Button>
			)}
			{(error || saved.error) && (
				<p role="alert" className="text-small text-danger">
					{error || saved.error}
				</p>
			)}
			{saved.error && (
				<Button disabled={busy || saved.loading} onClick={saved.reload}>
					重新读取
				</Button>
			)}
			<Button variant="primary" disabled={disabled || (!!saved.error && draft === null)} onClick={() => void apply()}>
				{busy ? "处理中…" : saved.loading ? "正在读取…" : "应用"}
			</Button>
		</section>
	);
}
