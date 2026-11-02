import { Download, FileText, ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";

/** Bytes are fetched through the current runtime after it checks the session's attachment membership. */
export function MessageAttachment({
	attachment,
	session,
}: {
	attachment: { kind: string; uri: string; name?: string };
	session: string;
}) {
	const node = useActiveNode();
	const [url, setUrl] = useState("");
	const [name, setName] = useState(attachment.name ?? attachment.kind);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const pending = useRef<AbortController | null>(null);
	const image = attachment.kind === "image";
	useEffect(() => () => pending.current?.abort(), []);
	useEffect(
		() => () => {
			if (url) URL.revokeObjectURL(url);
		},
		[url],
	);
	const load = async () => {
		setLoading(true);
		setError("");
		const controller = new AbortController();
		pending.current = controller;
		try {
			const result = await rpc<{ name: string; mime: string; dataBase64: string }>(
				"attachments.get",
				{ session, uri: attachment.uri },
				controller.signal,
				node,
			);
			const bytes = Uint8Array.from(atob(result.dataBase64), (character) => character.charCodeAt(0));
			controller.signal.throwIfAborted();
			const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
			setUrl(objectUrl);
			setName(result.name);
			if (!image) {
				const link = document.createElement("a");
				link.href = objectUrl;
				link.download = result.name;
				link.click();
			}
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "附件读取失败");
		} finally {
			setLoading(false);
		}
	};
	return (
		<div className="min-w-0">
			{url ? (
				<>
					{image && <img src={url} alt={name} className="mb-2 max-h-80 max-w-full rounded-control object-contain" />}
					<a href={url} download={name} className="flex min-h-10 items-center gap-2 break-all underline">
						<Download size={16} className="shrink-0" aria-hidden />
						下载 {name}
					</a>
				</>
			) : (
				<button
					type="button"
					onClick={() => void load()}
					disabled={loading}
					className="press flex min-h-10 items-center gap-2 break-all text-left underline disabled:opacity-50"
					aria-label={`${image ? "查看图片" : "下载文件"} ${name}`}
				>
					{image ? (
						<ImageIcon size={16} className="shrink-0" aria-hidden />
					) : (
						<FileText size={16} className="shrink-0" aria-hidden />
					)}
					<span>{loading ? "正在读取…" : name}</span>
				</button>
			)}
			{error && (
				<p role="alert" className="mt-1 text-caption">
					{error}
				</p>
			)}
		</div>
	);
}
