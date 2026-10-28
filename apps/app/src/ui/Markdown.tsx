import { lazy, Suspense } from "react";

const Content = lazy(async () => {
	const [{ default: Md }, { default: gfm }] = await Promise.all([import("react-markdown"), import("remark-gfm")]);
	return {
		default: ({ text }: { text: string }) => (
			<div className="md">
				<Md remarkPlugins={[gfm]}>{text}</Md>
			</div>
		),
	};
});

export function Markdown({ text }: { text: string }) {
	return (
		<Suspense fallback={<div className="whitespace-pre-wrap break-words">{text}</div>}>
			<Content text={text} />
		</Suspense>
	);
}
