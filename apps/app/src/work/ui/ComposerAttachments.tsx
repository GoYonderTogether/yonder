import type { Attachment } from "@yonder/gateway/protocol";
import { FileText, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { type NodeTarget, rpc } from "../api/client";

export const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export interface PendingAttachment {
	id: string;
	file: File;
	attachment?: Attachment;
	error?: string;
}

export function fileBase64(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(new Error("无法读取文件"));
		reader.readAsDataURL(file);
	});
}

export function useAttachments(node: NodeTarget) {
	const [items, setItems] = useState<PendingAttachment[]>([]);
	const upload = async (item: PendingAttachment) => {
		setItems((all) => all.map((entry) => (entry.id === item.id ? { ...entry, error: undefined } : entry)));
		try {
			if (item.file.size > MAX_ATTACHMENT_BYTES) throw new Error("文件超过 6 MB，请缩小后重新添加");
			const attachment = await rpc<Attachment>(
				"attachments.put",
				{
					name: item.file.name,
					mime: item.file.type || "application/octet-stream",
					dataBase64: await fileBase64(item.file),
				},
				undefined,
				node,
			);
			setItems((all) =>
				all.map((entry) => (entry.id === item.id ? { ...entry, attachment, error: undefined } : entry)),
			);
		} catch (failure) {
			setItems((all) =>
				all.map((entry) =>
					entry.id === item.id ? { ...entry, error: failure instanceof Error ? failure.message : "上传失败" } : entry,
				),
			);
		}
	};
	const add = (files: FileList | File[]) => {
		const next = Array.from(files).map((file) => ({ id: crypto.randomUUID(), file }));
		setItems((all) => [...all, ...next]);
		for (const item of next) void upload(item);
	};
	return {
		items,
		add,
		retry: upload,
		remove: (id: string) => setItems((all) => all.filter((item) => item.id !== id)),
		clear: () => setItems([]),
		ready: items.every((item) => !!item.attachment),
		attachments: items.flatMap((item) => (item.attachment ? [item.attachment] : [])),
	};
}

export function AttachmentButton({ onFiles, disabled }: { onFiles(files: FileList): void; disabled?: boolean }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				multiple
				className="hidden"
				aria-label="上传图片或文件"
				onChange={(event) => {
					if (event.target.files) onFiles(event.target.files);
					event.target.value = "";
				}}
			/>
			<button
				type="button"
				disabled={disabled}
				aria-label="添加图片或文件"
				className="press grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-raised disabled:opacity-40"
				onClick={() => input.current?.click()}
			>
				<Plus size={20} aria-hidden />
			</button>
		</>
	);
}

export function AttachmentList({
	items,
	onRemove,
	onRetry,
	disabled,
}: {
	items: PendingAttachment[];
	onRemove(id: string): void;
	onRetry(item: PendingAttachment): void;
	disabled?: boolean;
}) {
	if (!items.length) return null;
	return (
		<ul className="mx-auto mb-2 flex max-w-[900px] flex-wrap gap-2" aria-label="待发送附件">
			{items.map((item) => (
				<li
					key={item.id}
					className="flex min-w-0 max-w-full items-center gap-2 rounded-control bg-tone px-2 py-1 text-caption"
				>
					<FileText size={15} className="shrink-0" aria-hidden />
					<span className="min-w-0">
						<span className="block max-w-52 truncate">{item.file.name}</span>
						{item.error ? (
							<span role="alert" className="block text-danger">
								{item.error}
							</span>
						) : (
							<span className="text-faint">{item.attachment ? "已上传 · 发送后交给 Agent" : "上传中…"}</span>
						)}
					</span>
					{item.error && (
						<button
							type="button"
							disabled={disabled}
							className="press min-h-9 px-1 underline"
							onClick={() => onRetry(item)}
						>
							重试
						</button>
					)}
					<button
						type="button"
						disabled={disabled}
						aria-label={`移除 ${item.file.name}`}
						className="press grid size-9 shrink-0 place-items-center rounded-full"
						onClick={() => onRemove(item.id)}
					>
						<X size={14} aria-hidden />
					</button>
				</li>
			))}
		</ul>
	);
}
