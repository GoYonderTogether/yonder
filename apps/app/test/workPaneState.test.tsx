import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router";
import { expect, it, vi } from "vitest";
import { WorkShell } from "../src/work/WorkShell";

const state = vi.hoisted(() => ({
	width: "desktop",
	rail: "present",
	node: "pane-test",
	device: undefined as string | undefined,
}));
vi.mock("../src/work/api/nodes", () => ({
	useActiveNode: () => ({ id: state.node, deviceId: state.device }),
	activeNode: () => ({ id: state.node, deviceId: state.device }),
}));
vi.mock("../src/work/api/stream", () => ({ mux: { subscribe: () => () => {} } }));
vi.mock("../src/work/lib/queries", () => ({
	useRefetchOnReconnect: () => {},
	useTitleOf: () => () => "会话",
	useDeviceAgents: () => ({ data: [] }),
	deviceAgentMap: () => new Map(),
}));
vi.mock("../src/work/lib/branch", () => ({ useBranchLabel: () => undefined }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}) }));
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
vi.mock("../src/work/ui/RailStack", () => ({
	CardStack: () => (
		<div>
			卡片<Link to="/work/sub">子任务</Link>
		</div>
	),
}));
vi.mock("../src/work/ui/WorkList", () => ({
	WorkList: () => <Link to={state.device ? `/work/device/${state.device}/s` : "/work/s"}>当前会话</Link>,
}));
vi.mock("../src/work/features/Settings", () => ({ Settings: () => <div>设置页面</div> }));
vi.mock("radix-ui", () => ({
	DropdownMenu: {
		Item: ({ children, onSelect }: { children: React.ReactNode; onSelect?(): void }) => (
			<button type="button" onClick={onSelect}>
				{children}
			</button>
		),
	},
}));
vi.mock("../src/work/ui/WorkToolbar", () => ({
	WorkToolbar: (p: {
		title: React.ReactNode;
		leftOpen?: boolean;
		onLeft?(): void;
		rightOpen?: boolean;
		onRight?(): void;
		more?: React.ReactNode;
	}) => (
		<div data-testid="local-work-header">
			{p.onLeft && (
				<button type="button" aria-label={p.leftOpen ? "收起工作列表" : "展开工作列表"} onClick={p.onLeft} />
			)}
			{p.onRight && <button type="button" aria-label={p.rightOpen ? "收起右栏" : "展开右栏"} onClick={p.onRight} />}
			{p.more}
		</div>
	),
}));
vi.mock("../src/work/features/Chat", () => ({
	FloatMenu: () => null,
	Chat: (p: {
		header?: React.ReactNode;
		id: string;
		wide: boolean;
		showRail: boolean;
		rightPanel: string;
		onChannels(): void;
		onList?(): void;
	}) => (
		<section data-testid="test-chat" data-wide={String(p.wide)} data-rail={String(p.showRail)}>
			{p.header}
			{p.id === "missing" ? "找不到会话" : "正文"}
			<Link to="/work/s">返回父任务</Link>
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

function NavigationProbe() {
	const location = useLocation();
	const navigate = useNavigate();
	return (
		<>
			<output data-testid="path">{location.pathname}</output>
			<button type="button" onClick={() => navigate("/work/sub")}>
				打开子任务
			</button>
			<button type="button" onClick={() => navigate("/work/s")}>
				打开父任务
			</button>
			<button type="button" onClick={() => navigate(-1)}>
				浏览器返回
			</button>
		</>
	);
}

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
					<NavigationProbe />
				</MemoryRouter>,
			);
		});
	await show();
	return { container, root, show };
}
function click(element: Element | null | undefined) {
	if (!element) throw new Error("missing control");
	const key = Object.keys(element).find((k) => k.startsWith("__reactProps$")) ?? "";
	(element as unknown as Record<string, { onClick(e: unknown): void }>)[key].onClick({
		button: 0,
		preventDefault() {},
		defaultPrevented: false,
	});
}
const button = (container: HTMLElement, label: string) =>
	[...container.querySelectorAll("button")].find(
		(b) => b.getAttribute("aria-label") === label || b.textContent === label,
	);

it.each(["desktop", "tablet", "phone"])("%s 右栏关闭及恢复默认", async (width) => {
	state.node = `toggle-${width}`;
	state.width = width;
	state.rail = "present";
	const { container, root } = await render("/work/s");
	expect(container.querySelector('[data-testid="test-chat"]')?.getAttribute("data-rail")).toBe("true");
	await act(() => click(button(container, "收起右栏")));
	expect(container.querySelector('[data-testid="test-chat"]')?.getAttribute("data-rail")).toBe("false");
	await act(() => click(button(container, "恢复默认视图")));
	expect(container.querySelector('[data-testid="test-chat"]')?.getAttribute("data-rail")).toBe("true");
	await act(() => root.unmount());
});
it("平板打开渠道后左栏让位", async () => {
	state.node = "channels";
	state.width = "tablet";
	state.rail = "empty";
	const { container, root } = await render("/work/s");
	expect(container.querySelectorAll("aside")).toHaveLength(1);
	await act(() => click(button(container, "渠道")));
	expect(container.querySelectorAll("aside")).toHaveLength(1);
	expect(container.textContent).toContain("channels");
	await act(() => root.unmount());
});
it("旧工作设置链接跳转统一设置", async () => {
	state.node = "settings";
	state.width = "desktop";
	state.rail = "empty";
	const { container, root } = await render("/work/settings");
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/me/settings");
	await act(() => root.unmount());
});
it("会话标题属于内容区，列表没有会话操作", async () => {
	state.node = "header-ownership";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	const list = container.querySelector("aside");
	const chat = container.querySelector('[data-testid="test-chat"]');
	expect(list?.querySelector('[data-testid="local-work-header"]')).toBeTruthy();
	expect(list?.textContent).not.toContain("恢复默认视图");
	expect(chat?.querySelector('[data-testid="local-work-header"]')?.textContent).toContain("恢复默认视图");
	expect(container.textContent).not.toContain("工作设置");
	await act(() => root.unmount());
});
it("会话返回再点击当前会话可进入正文", async () => {
	state.node = "alias";
	state.device = "device-a";
	state.width = "phone";
	state.rail = "empty";
	const { container, root } = await render("/work/s");
	await act(() => click(button(container, "打开子任务")));
	await act(() => click(button(container, "浏览器返回")));
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/work/s");
	expect(container.textContent).toContain("正文");
	state.device = undefined;
	await act(() => root.unmount());
});
it("切换设备与断点不复用右栏关闭意图", async () => {
	state.node = "device-a";
	state.width = "desktop";
	state.rail = "present";
	const { container, root, show } = await render("/work/s");
	await act(() => click(button(container, "收起右栏")));
	state.node = "device-b";
	state.width = "tablet";
	await show();
	expect(container.querySelector('[data-testid="test-chat"]')?.getAttribute("data-rail")).toBe("true");
	state.node = "device-a";
	state.width = "desktop";
	await show();
	expect(container.querySelector('[data-testid="test-chat"]')?.getAttribute("data-rail")).toBe("false");
	await act(() => root.unmount());
});
