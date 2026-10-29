import mark from "../assets/brand/yonder-mark.svg?raw";
import markSmall from "../assets/brand/yonder-mark-small.svg?raw";

// 标志"同望"，唯一来源是仓库 brand/；这里只引用生成物，不改形状。
const inline = (svg: string) =>
	svg
		.replace(/ width="\d+" height="\d+"/, ' width="100%" height="100%"')
		.replace(/fill="#[0-9a-f]{6}"/i, 'fill="currentColor"')
		.replace(/<title>.*?<\/title>/, "");

/** 墨色圆角方块里的白色标志；24px 及以下用简化版。 */
export function Logo({ size = 28, radius = 0.22 }: { size?: number; radius?: number }) {
	return (
		<span
			role="img"
			aria-label="Yonder"
			className="inline-flex shrink-0 items-center justify-center bg-accent text-on-accent"
			style={{ width: size, height: size, borderRadius: size * radius, padding: size * 0.1 }}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: 内联的是打包进来的品牌 SVG，不是用户输入
			dangerouslySetInnerHTML={{ __html: inline(size <= 24 ? markSmall : mark) }}
		/>
	);
}
