import { lazy, Suspense } from "react";

const Content = lazy(() => import("./MarkdownContent"));

export function Markdown({ text }: { text: string }) {
	return (
		<Suspense fallback={<div className="whitespace-pre-wrap break-words">{text}</div>}>
			<Content text={text} />
		</Suspense>
	);
}
