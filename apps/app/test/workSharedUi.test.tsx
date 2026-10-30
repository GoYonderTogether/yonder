import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { Button } from "../src/ui/Button";
import { Field } from "../src/ui/Field";
import { Toaster } from "../src/ui/Toast";
import { Button as WorkButton } from "../src/work/ui/kit/Button";
import { Field as WorkField } from "../src/work/ui/kit/Field";
import { toast } from "../src/work/ui/kit/Toast";

it("工作提示由全站 Toaster 显示，并复用按钮与字段", async () => {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const root = createRoot(window.document.getElementById("root") as unknown as HTMLElement);
	try {
		expect(WorkButton).toBe(Button);
		expect(WorkField).toBe(Field);
		await act(async () => root.render(<Toaster />));
		await act(async () => toast("工作区操作失败", true));
		expect(window.document.body.textContent).toContain("工作区操作失败");
		expect(window.document.querySelector('[role="status"]')).not.toBeNull();
	} finally {
		await act(async () => root.unmount());
		vi.unstubAllGlobals();
	}
});
