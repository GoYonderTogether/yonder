import type { CardDisplay } from "../api/types";

// 展示卡片只在无权限的 sandbox iframe 里渲染（不开 allow-same-origin / top-navigation / forms）。
export function Sandbox({ display }: { display: CardDisplay }) {
	const doc =
		display.kind === "svg"
			? `<style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style>${display.source}`
			: display.source;
	return <iframe title="展示卡片" sandbox="" srcDoc={doc} className="aspect-[9/5] w-full rounded-card bg-tone" />;
}
