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
vi.mock("../src/work/ui/WorkToolbar", () => ({
	WorkToolbar: (p: {
		title: React.ReactNode;
		leftOpen: boolean;
		onLeft(): void;
		mode?: string;
		onMode?(mode: string): void;
		primary?: React.ReactNode;
	}) => (
		<div data-testid="local-work-header">
			<button type="button" aria-label={p.leftOpen ? "收起工作列表" : "展开工作列表"} onClick={p.onLeft} />
			{p.onMode && (
				<select aria-label="工作区域显示" value={p.mode} onChange={(event) => p.onMode?.(event.target.value)}>
					<option value="auto">自动</option>
					<option value="list">列表</option>
					<option value="content">内容</option>
					<option value="rail">右栏</option>
				</select>
			)}
			{p.primary}
		</div>
	),
}));
vi.mock("../src/work/features/Chat", () => ({
	FloatMenu: () => null,
	Chat: (p: {
		id: string;
		wide: boolean;
		showRail: boolean;
		rightPanel: string;
		onChannels(): void;
		onList?(): void;
	}) => (
		<section data-testid="test-chat" data-wide={String(p.wide)} data-rail={String(p.showRail)}>
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
it("列表和会话操作分别位于各自的局部区域", async () => {
	state.node = "local-headers";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	const headers = container.querySelectorAll('[data-testid="local-work-header"]');
	expect(headers).toHaveLength(2);
	expect(headers[0].closest("aside")).not.toBeNull();
	expect(headers[1].closest("aside")).toBeNull();
	expect(headers[0].parentElement).not.toBe(headers[1].parentElement);
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

const widths = ["desktop", "tablet", "phone"] as const;
const modes = ["auto", "list", "content", "rail"] as const;
const railStates = ["loading", "error", "empty", "present"] as const;
it.each(widths.flatMap((width) => modes.flatMap((mode) => railStates.map((rail) => ({ width, mode, rail })))))(
	"会话 $width / $mode / $rail 保持容量和恢复入口",
	async ({ width, mode, rail }) => {
		state.node = `matrix-${width}-${mode}-${rail}`;
		state.width = width;
		state.rail = "present";
		const { container, root, show } = await render("/work/s");
		await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, mode));
		state.rail = rail;
		await show();
		const selected = (container.querySelector('[aria-label="工作区域显示"]') as HTMLSelectElement).value;
		expect(selected).toBe(mode);
		const list = !!container.querySelector("aside") && container.textContent!.includes("当前会话");
		const chat = container.querySelector('[data-testid="test-chat"]');
		const exclusiveRail = !!container.querySelector('main[aria-label="右栏"]');
		const right = exclusiveRail || chat?.getAttribute("data-rail") === "true";
		if (width === "tablet") expect(Number(list) + Number(!!chat) + Number(right)).toBeLessThanOrEqual(2);
		if (mode === "list") {
			expect(container.textContent).not.toContain("正文");
			expect(container.textContent).toContain("当前会话");
		}
		if (mode === "content") {
			expect(chat).not.toBeNull();
			expect(right).toBe(false);
		}
		if (mode === "rail" && rail !== "empty") {
			expect(exclusiveRail).toBe(true);
			expect(container.textContent).toContain("浮窗");
		}
		if (mode === "rail" && rail === "empty") expect(chat).not.toBeNull();
		if (mode === "auto" && rail === "empty") expect(right).toBe(false);
		if (width === "phone" && chat?.getAttribute("data-rail") === "true") expect(list).toBe(false);
		expect(container.querySelector('[aria-label="工作区域显示"]')).not.toBeNull();
		await act(() => root.unmount());
	},
);

it.each(widths.flatMap((width) => ["/work", "/work/settings"].map((path) => ({ width, path }))))(
	"$width 非会话 $path 不显示会话右栏",
	async ({ width, path }) => {
		state.node = `page-${width}-${path}`;
		state.width = width;
		state.rail = "present";
		const { container, root } = await render(path);
		expect(container.querySelector('[data-testid="test-chat"]')).toBeNull();
		expect(container.querySelector('main[aria-label="右栏"]')).toBeNull();
		expect(container.querySelector('[aria-label="工作区域显示"]')).toBeNull();
		await act(() => root.unmount());
	},
);

it("跨断点往返和设备切换不篡改会话独显", async () => {
	state.node = "device-a";
	state.width = "desktop";
	state.rail = "present";
	const { container, root, show } = await render("/work/s");
	await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, "rail"));
	state.width = "phone";
	await show();
	expect(container.querySelector('main[aria-label="右栏"]')).not.toBeNull();
	state.node = "device-b";
	await show();
	expect((container.querySelector('[aria-label="工作区域显示"]') as HTMLSelectElement).value).toBe("auto");
	state.node = "device-a";
	state.width = "tablet";
	await show();
	expect((container.querySelector('[aria-label="工作区域显示"]') as HTMLSelectElement).value).toBe("rail");
	state.width = "desktop";
	await show();
	expect(container.querySelector('main[aria-label="右栏"]')).not.toBeNull();
	await act(() => root.unmount());
});

it("独显右栏进入子任务再返回，父会话选择保持", async () => {
	state.node = "child-return";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, "rail"));
	await act(() => click([...container.querySelectorAll("a")].find((a) => a.textContent === "子任务")!));
	expect(container.textContent).toContain("正文");
	await act(() => click([...container.querySelectorAll("a")].find((a) => a.textContent === "返回父任务")!));
	expect((container.querySelector('[aria-label="工作区域显示"]') as HTMLSelectElement).value).toBe("rail");
	expect(container.querySelector('main[aria-label="右栏"]')).not.toBeNull();
	await act(() => root.unmount());
});

it("旧深链点击当前会话进入设备规范路由，浏览器返回不覆盖列表选择", async () => {
	state.node = "account:owner:device:device-a";
	state.device = "device-a";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, "list"));
	await act(() => click([...container.querySelectorAll("a")].find((a) => a.textContent === "当前会话")!));
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/work/device/device-a/s");
	expect(container.textContent).toContain("正文");
	await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, "list"));
	await act(() => click([...container.querySelectorAll("button")].find((b) => b.textContent === "浏览器返回")!));
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/work/s");
	expect((container.querySelector('[aria-label="工作区域显示"]') as HTMLSelectElement).value).toBe("list");
	state.device = undefined;
	await act(() => root.unmount());
});

it("主动打开以前选过仅列表的另一会话时进入正文", async () => {
	state.node = "saved-list-destination";
	state.width = "desktop";
	state.rail = "present";
	const { container, root } = await render("/work/s");
	await act(() => change(container.querySelector('[aria-label="工作区域显示"]')!, "list"));
	await act(() => click([...container.querySelectorAll("button")].find((b) => b.textContent === "打开子任务")!));
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/work/sub");
	await act(() => click([...container.querySelectorAll("button")].find((b) => b.textContent === "打开父任务")!));
	expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/work/s");
	expect(container.textContent).toContain("正文");
	await act(() => root.unmount());
});
