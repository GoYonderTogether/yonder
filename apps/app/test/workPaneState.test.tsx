import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkShell } from "../src/work/WorkShell";

const state = vi.hoisted(() => ({ width: "desktop", rail: "present", node: "pane-test" }));
vi.mock("../src/work/api/nodes", () => ({ useActiveNode: () => ({ id: state.node }) }));
vi.mock("../src/work/api/stream", () => ({ mux: { subscribe: () => () => {} } }));
vi.mock("../src/work/lib/queries", () => ({ useRefetchOnReconnect: () => {} }));
vi.mock("../src/work/lib/useSession", () => ({
	useSession: () => ({ session: { id: "s" }, ready: true, todos: [], subtasks: [], background: [] }),
}));
vi.mock("../src/work/lib/railContent", () => ({ useRailContent: () => state.rail }));
vi.mock("../src/work/features/ImportView", () => ({ useImport: () => ({}) }));
vi.mock("../src/work/shell/useBreakpoint", () => ({ useBreakpoint: () => state.width }));
vi.mock("../src/components/PersonalDrawer", () => ({ PersonalAvatar: () => null }));
vi.mock("../src/work/features/notify/NotifyHost", () => ({ NotifyHost: () => null }));
vi.mock("../src/work/ui/Banner", () => ({ Banner: () => null }));
vi.mock("../src/work/ui/FloatLayer", () => ({ FloatLayer: () => <div>浮窗</div> }));
vi.mock("../src/work/ui/RailStack", () => ({ CardStack: () => <div>卡片</div> }));
vi.mock("../src/work/ui/WorkList", () => ({ WorkList: () => <Link to="/work/s">当前会话</Link> }));
vi.mock("../src/work/features/Settings", () => ({ Settings: () => <div>设置页面</div> }));
vi.mock("../src/work/features/Chat", () => ({
	Chat: (p: { showRail: boolean; rightPanel: string; onChannels(): void; onList?(): void }) => (
		<section>
			正文
			<button type="button" onClick={p.onChannels}>
				渠道
			</button>
			{p.onList && (
				<button type="button" onClick={p.onList}>
					展开工作列表
				</button>
			)}
			{p.showRail && <aside>{p.rightPanel}</aside>}
		</section>
	),
}));

async function render(path: string) {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	const show = async () =>
		act(async () => {
			root.render(
				<MemoryRouter initialEntries={[path]}>
					<WorkShell onLogout={() => {}} />
				</MemoryRouter>,
			);
		});
	await show();
	return { container, root, show };
}
function change(element: Element, value: string) {
	const key = Object.keys(element).find((k) => k.startsWith("__reactProps$"))!;
	(element as unknown as Record<string, { onChange(e: unknown): void }>)[key].onChange({ target: { value } });
}
function click(element: Element) {
	const key = Object.keys(element).find((k) => k.startsWith("__reactProps$"))!;
	(element as unknown as Record<string, { onClick(e: unknown): void }>)[key].onClick({
		button: 0,
		preventDefault() {},
		defaultPrevented: false,
	});
}

it("仅列表点击当前会话恢复正文", async () => {
	state.node = "same-session";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	await act(() => change(container.querySelector("select")!, "list"));
	expect(container.textContent).not.toContain("正文");
	await act(() => click([...container.querySelectorAll("a")].find((a) => a.textContent === "当前会话")!));
	expect(container.textContent).toContain("正文");
	await act(() => root.unmount());
});
it("平板打开渠道时列表让位，右栏加载不丢独显选择", async () => {
	state.node = "tablet-session";
	state.width = "tablet";
	state.rail = "empty";
	const { container, root, show } = await render("/work/s");
	expect(container.querySelector("aside")).not.toBeNull();
	await act(() => click([...container.querySelectorAll("button")].find((b) => b.textContent === "渠道")!));
	expect(container.querySelectorAll("aside")).toHaveLength(1);
	expect(container.textContent).toContain("channels");
	state.node = "loading-session";
	state.rail = "present";
	await show();
	await act(() => change(container.querySelector("select")!, "rail"));
	state.rail = "loading";
	await show();
	expect(container.textContent).toContain("卡片");
	state.rail = "present";
	await show();
	expect((container.querySelector("select") as HTMLSelectElement).value).toBe("rail");
	await act(() => root.unmount());
});

it("设置收起列表后仍能展开", async () => {
	state.node = "settings-restore";
	state.width = "desktop";
	state.rail = "empty";
	const { container, root } = await render("/work/settings");
	await act(() => click(container.querySelector('[aria-label="收起工作列表"]')!));
	const restore = container.querySelector('[aria-label="展开工作列表"]');
	expect(restore).not.toBeNull();
	await act(() => click(restore!));
	expect(container.querySelector('[aria-label="收起工作列表"]')).not.toBeNull();
	await act(() => root.unmount());
});
