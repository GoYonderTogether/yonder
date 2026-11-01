import { useEffect, useRef, useState } from "react";
import type { Message } from "../api/types";
export function newMessageBatch(previous: number | undefined, messages: Pick<Message, "id" | "seq">[]) {
	const highest = messages.reduce((n, m) => Math.max(n, m.seq), previous ?? 0);
	return {
		highest,
		ids:
			previous === undefined
				? []
				: messages
						.filter((m) => m.seq > previous)
						.slice(-20)
						.map((m) => m.id),
	};
}
/** History windows and refetches never replay entrance animations. */
export function useNewMessages(messages: Message[]) {
	const highest = useRef<number | undefined>(undefined);
	const clearTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(
		() => () => {
			if (clearTimer.current) clearTimeout(clearTimer.current);
		},
		[],
	);
	const [fresh, setFresh] = useState<Set<string>>(() => new Set());
	useEffect(() => {
		if (!messages.length) return;
		const batch = newMessageBatch(highest.current, messages);
		highest.current = batch.highest;
		if (!batch.ids.length) return;
		setFresh(new Set(batch.ids));
		if (clearTimer.current) clearTimeout(clearTimer.current);
		clearTimer.current = setTimeout(() => setFresh(new Set()), 260);
	}, [messages]);
	return fresh;
}

export function historyScrollBehavior(): ScrollBehavior {
	return typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? "auto"
		: "smooth";
}
