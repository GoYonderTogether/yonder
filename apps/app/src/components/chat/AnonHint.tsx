import { X } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../ui/Button";

const KEY = "yonder:anon-hint-dismissed";
const read = () => {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
};

/** 匿名用户在会话里发出第 3 条消息后出现一次的行内提示；关掉后永不再出现。 */
export function AnonHint({ sent }: { sent: number }) {
	const nav = useNavigate();
	const loc = useLocation();
	const [gone, setGone] = useState(read);
	if (gone || sent < 3) return null;
	const dismiss = () => {
		try {
			localStorage.setItem(KEY, "1");
		} catch {}
		setGone(true);
	};
	const next = loc.pathname + loc.search;
	return (
		<div className="fade mx-auto my-3 flex w-fit max-w-full items-center gap-2 rounded-full bg-tone py-1 pr-1 pl-4 text-small text-muted">
			<span className="min-w-0">注册保存聊天记录，换设备也能找回</span>
			<Button
				variant="primary"
				size="sm"
				onClick={() => nav(`/login?mode=register&next=${encodeURIComponent(next)}`, { state: { next } })}
			>
				注册
			</Button>
			<button
				type="button"
				aria-label="关闭"
				onClick={dismiss}
				className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-tone-2"
			>
				<X size={14} />
			</button>
		</div>
	);
}
