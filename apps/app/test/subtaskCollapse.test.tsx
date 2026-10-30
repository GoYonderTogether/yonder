import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkCards } from "../src/work/ui/WorkCards";

it("已展开子任务完成时折叠，仍可重新展开", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div");
	const root = createRoot(container as never);
	const render = (state: "running" | "done") =>
		root.render(
			<MemoryRouter>
				<WorkCards subtasks={[{ id: "1", session: "child", label: "任务", state }]} background={[]} />
			</MemoryRouter>,
		);
	await act(() => render("running"));
	const button = container.querySelector("button") as unknown as HTMLElement;
	await act(() => button.click());
	expect(button.getAttribute("aria-expanded")).toBe("true");
	await act(() => render("done"));
	expect(button.getAttribute("aria-expanded")).toBe("false");
	await act(() => button.click());
	expect(button.getAttribute("aria-expanded")).toBe("true");
	expect(container.textContent).toContain("打开这个子 Bot 的对话");
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});
