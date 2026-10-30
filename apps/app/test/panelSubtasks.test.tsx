import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { emptyView } from "../src/work/lib/useSession";
import { PanelBody } from "../src/work/ui/PanelBody";

const data = vi.hoisted(() => ({ sessions: [] as Array<Record<string, unknown>> }));
vi.mock("../src/work/lib/queries", () => ({ useWorkSessions: () => ({ data: data.sessions }) }));

it("keeps active subtasks visible and folds completed, failed, and archived ones", () => {
	data.sessions = [{ id: "archived", parent: "parent", archivedAt: 1 }];
	const rows = [
		{ id: "1", session: "running", label: "运行中", state: "running", startedAt: "" },
		{ id: "2", session: "done", label: "完成", state: "done", startedAt: "" },
		{ id: "3", session: "failed", label: "失败", state: "error", startedAt: "" },
		{ id: "4", session: "archived", label: "归档", state: "waiting", startedAt: "" },
	] as const;
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<PanelBody kind="subtasks" session="parent" v={{ ...emptyView, subtasks: [...rows] }} />
		</MemoryRouter>,
	);
	const { document } = parseHTML(html);
	const details = document.querySelector("details");
	expect(details?.hasAttribute("open")).toBe(false);
	expect(details?.querySelector("summary")?.textContent).toBe("已完成（3）");
	expect(details?.textContent).toContain("完成");
	expect(details?.textContent).toContain("失败");
	expect(details?.textContent).toContain("归档");
	expect(document.querySelector('a[href="/work/running"]')?.closest("details")).toBeNull();
});

it("folds closed and archived fallback child sessions without removing them", () => {
	data.sessions = [
		{ id: "a", parent: "parent", profile: "x", mode: "task", key: "", title: "已关闭", closed: "2026-01-01" },
		{ id: "b", parent: "parent", profile: "x", mode: "task", key: "", title: "已归档", archivedAt: 1 },
	];
	const html = renderToStaticMarkup(
		<MemoryRouter>
			<PanelBody kind="subtasks" session="parent" v={emptyView} />
		</MemoryRouter>,
	);
	const { document } = parseHTML(html);
	expect(document.querySelector("details summary")?.textContent).toBe("已完成（2）");
	expect(document.querySelector('details a[href="/work/a"]')).not.toBeNull();
	expect(document.querySelector('details a[href="/work/b"]')).not.toBeNull();
});
