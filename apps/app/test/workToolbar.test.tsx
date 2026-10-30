import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkToolbar } from "../src/work/ui/WorkToolbar";

it("工作顶栏按真实状态命名左右开关并禁止无内容的右栏独显", () => {
	const html = renderToStaticMarkup(
		<WorkToolbar
			phone={false}
			title="任务"
			leftOpen
			onLeft={() => {}}
			rightOpen={false}
			onRight={() => {}}
			mode="auto"
			onMode={() => {}}
			railAvailable={false}
		/>,
	);
	expect(html).toContain('aria-label="收起工作列表"');
	expect(html).toContain('aria-label="展开右栏"');
	expect(html).toMatch(/<option value="rail" disabled=""/);
});

it("手机使用调用方的返回或头像入口，并将工作布局放进更多", () => {
	const html = renderToStaticMarkup(
		<WorkToolbar
			phone
			title="任务"
			leading={<button type="button">返回</button>}
			mode="auto"
			onMode={() => {}}
			onRight={() => {}}
		/>,
	);
	expect(html).toContain("返回");
	expect(html).toContain('aria-label="工作区更多"');
	expect(html).not.toContain('aria-label="展开工作列表"');
});
