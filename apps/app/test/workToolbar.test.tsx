import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkToolbar } from "../src/work/ui/WorkToolbar";

it("局部标题按真实状态命名面板开关，不显示布局选择", () => {
	const html = renderToStaticMarkup(
		<WorkToolbar
			phone={false}
			title="任务"
			leftOpen
			onLeft={() => {}}
			rightOpen={false}
			onRight={() => {}}
			more="更多"
		/>,
	);
	expect(html).toContain('aria-label="收起工作列表"');
	expect(html).toContain('aria-label="展开右栏"');
	expect(html).toContain('aria-label="工作区更多"');
	expect(html).not.toContain("<select");
});

it("手机保留返回入口与右栏开关", () => {
	const html = renderToStaticMarkup(
		<WorkToolbar phone title="任务" leading={<button type="button">返回</button>} onRight={() => {}} more="更多" />,
	);
	expect(html).toContain("返回");
	expect(html).toContain('aria-label="工作区更多"');
	expect(html).not.toContain('aria-label="展开工作列表"');
});
