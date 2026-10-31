import { useEffect, useRef } from "react";
import { charDelay, newTailStart, splitForTyping, TYPE_MS } from "../lib/typewriter";

/**
 * 流式回复的逐字入场：单字 90ms 从模糊到清晰，相邻字错开 30ms 晕开。
 * 只给本次新出现的字挂动画，已经显示的字不重播。
 * 逐字只能作用于纯文本：Markdown 的结构不能切开，所以流式期间先按纯文本显示，
 * 落定后由调用方换回 Markdown（见 Transcript 的 Bubble）。
 */
export function TypingText({ text }: { text: string }) {
	const previous = useRef("");
	const start = newTailStart(previous.current, text);
	useEffect(() => {
		previous.current = text;
	}, [text]);
	const { head, chars } = splitForTyping(text, start);
	return (
		<span className="whitespace-pre-wrap break-words">
			{head}
			<span className="type-in">
				{chars.map((ch, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: 逐字入场按位置对齐，文本只追加不重排
						key={start + i}
						style={{ animationDuration: `${TYPE_MS}ms`, animationDelay: `${charDelay(i)}ms` }}
					>
						{ch}
					</span>
				))}
			</span>
			<span className="caret" role="img" aria-label="正在回复" />
		</span>
	);
}
