import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AppBar } from "../src/components/AppBar";
import { PaneLeftCollapse, PaneLeftExpand, PaneRightCollapse, PaneRightExpand } from "../src/ui/PaneIcons";

it("keeps title, subtitle and actions in a shared toolbar", () => {
	const html = renderToStaticMarkup(
		<AppBar
			title="工作"
			subtitle="真实会话"
			left={<button type="button">返回</button>}
			right={<button type="button">更多</button>}
		/>,
	);
	expect(html).toContain("工作");
	expect(html).toContain("真实会话");
	expect(html).toContain("返回");
	expect(html).toContain("更多");
});

it("renders arrow-free pane icons for both sides", () => {
	const icons = [PaneLeftCollapse, PaneLeftExpand, PaneRightCollapse, PaneRightExpand].map((Icon) =>
		renderToStaticMarkup(<Icon size={19} />),
	);
	expect(new Set(icons).size).toBe(2);
	for (const icon of icons) {
		expect(icon).toContain('aria-hidden="true"');
		expect(icon).toContain('width="19"');
		expect(icon.match(/<path/g)).toHaveLength(3);
	}
});
