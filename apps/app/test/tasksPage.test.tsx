import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Tasks } from "../src/pages/Tasks";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", async (importOriginal) => ({
	...(await importOriginal<object>()),
	rpc,
}));
vi.mock("../src/work/api/nodes", () => ({
	useActiveNode: () => ({ id: "local", name: "本机" }),
	activeNode: () => ({ id: "local", name: "本机" }),
}));
vi.mock("../src/work/lib/workOnline", () => ({ useWorkOnline: () => true, deviceOnline: () => true }));
vi.mock("../src/work/lib/queries", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useTitleOf: () => (s: { title?: string; id: string }) => s.title ?? s.id,
}));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	rpc.mockReset();
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<Tasks />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

it("任务分区列出活动节点的任务会话，点行进工作会话视图", async () => {
	rpc.mockImplementation((method: string, params?: { filter?: { archived?: boolean } }) => {
		if (method === "sessions.list")
			return Promise.resolve(
				params?.filter?.archived
					? [{ id: "done-1", mode: "task", title: "已完成的任务", opened: "2026-11-01T00:00:00Z" }]
					: [{ id: "task-1", mode: "task", opened: "2026-11-04T00:00:00Z" }],
			);
		if (method === "activity.summary") return Promise.resolve({ running: 0, sessions: [] });
		return Promise.reject(new Error(`unexpected ${method}`));
	});
	await render();
	const rows = [...container.querySelectorAll('[data-testid="task-row"] a, [data-testid="task-row"]')];
	expect(rows.length).toBe(2);
	expect(container.querySelector('a[href="/work/task-1"]')).not.toBeNull();
	expect(container.querySelector('a[href="/work/done-1"]')).not.toBeNull();
	expect(container.textContent).toContain("已完成的任务");
});
