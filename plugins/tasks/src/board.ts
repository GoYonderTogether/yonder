import type { Task, TaskEvent } from "./store.js";

export interface BoardItem {
	id: string;
	ref: string;
	title: string;
	state: Task["state"];
	ownerAgent: string | null;
	elapsedMs: number;
	idleMs: number;
	acceptance: { met: number; total: number };
	parent: string | null;
	origin?: string;
	children: BoardItem[];
}
export interface TaskBoard {
	counts: { waiting: number; inProgress: number; blocked: number };
	groups: Array<{ id: "waiting" | "inProgress" | "blocked" | "done"; items: BoardItem[] }>;
	detail?: { task: Task; history: TaskEvent[]; children: BoardItem[] };
}
export function taskBoard(tasks: Task[], now: number, detail?: { task: Task; history: TaskEvent[] }): TaskBoard {
	const item = (task: Task): BoardItem => ({
		id: task.id,
		ref: task.ref,
		title: task.title,
		state: task.state,
		ownerAgent: task.ownerAgent,
		elapsedMs: Math.max(
			0,
			(task.state === "done" || task.state === "cancelled" ? Date.parse(task.lastActivityAt) : now) -
				Date.parse(task.createdAt),
		),
		idleMs: Math.max(0, now - Date.parse(task.lastActivityAt)),
		acceptance: {
			met: task.acceptance.filter((_, i) => task.evidence[i]?.trim()).length,
			total: task.acceptance.length,
		},
		parent: task.parent,
		...(task.origin ? { origin: task.origin } : {}),
		children: tasks
			.filter(
				(child) =>
					child.parent === task.id &&
					(detail ||
						(child.state !== "cancelled" &&
							(child.state !== "done" || now - Date.parse(child.lastActivityAt) < 30 * 60000))),
			)
			.map(item),
	});
	const groups: TaskBoard["groups"] = [
		{ id: "waiting", items: tasks.filter((t) => t.state === "waiting-user" || t.state === "review").map(item) },
		{ id: "inProgress", items: tasks.filter((t) => t.state === "open" || t.state === "active").map(item) },
		{ id: "blocked", items: tasks.filter((t) => t.state === "blocked").map(item) },
		{
			id: "done",
			items: tasks.filter((t) => t.state === "done" && now - Date.parse(t.lastActivityAt) < 30 * 60000).map(item),
		},
	];
	return {
		counts: { waiting: groups[0]!.items.length, inProgress: groups[1]!.items.length, blocked: groups[2]!.items.length },
		groups,
		...(detail ? { detail: { ...detail, children: item(detail.task).children } } : {}),
	};
}
const labels = (zh: boolean) =>
	zh
		? { waiting: "等你", inProgress: "进行中", blocked: "阻塞", done: "刚完成" }
		: { waiting: "Waiting for you", inProgress: "In progress", blocked: "Blocked", done: "Just done" };
export function renderText(board: TaskBoard, locale = "en"): string {
	const zh = locale.startsWith("zh"),
		names = labels(zh);
	const line = (t: BoardItem) =>
		`${t.ref} ${t.title} · ${t.state} · ${t.ownerAgent ?? "—"} · ${Math.floor(t.elapsedMs / 60000)}m / ${zh ? "未更新" : "idle"} ${Math.floor(t.idleMs / 60000)}m · ${t.acceptance.met}/${t.acceptance.total}`;
	if (board.detail) {
		const { task, history, children } = board.detail;
		return [
			`${task.ref} ${task.title} · ${task.state}`,
			task.objective,
			...task.acceptance.map((point, i) => `${i + 1}. ${point}\n   ${task.evidence[i] ?? "—"}`),
			`${zh ? "交付" : "Deliverable"}: ${task.deliverable ?? "—"}`,
			`${zh ? "来源" : "Origin"}: ${task.origin ?? "—"}`,
			...history.map((e) => `${e.at} ${e.kind} ${JSON.stringify(e.data)}`),
			...children.map(line),
		].join("\n");
	}
	return [
		`${board.counts.waiting} ${names.waiting} · ${board.counts.inProgress} ${names.inProgress} · ${board.counts.blocked} ${names.blocked}`,
		...board.groups.filter((g) => g.items.length).flatMap((g) => [names[g.id], ...g.items.map(line)]),
	].join("\n");
}
const escapeXml = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
export function renderSvg(board: TaskBoard, locale = "en"): string {
	const lines = renderText(board, locale)
		.split("\n")
		.flatMap((line) => {
			const chars = Array.from(line);
			const wrapped: string[] = [];
			for (let i = 0; i < chars.length; i += 48) wrapped.push(chars.slice(i, i + 48).join(""));
			return wrapped.length ? wrapped : [""];
		});
	const height = 80 + lines.length * 30;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}"><rect width="960" height="${height}" rx="20" fill="#f5f7fa"/><rect x="12" y="12" width="936" height="${height - 24}" rx="14" fill="white"/><g font-family="PingFang SC, Noto Sans CJK SC, sans-serif" font-size="17" fill="#243449">${lines.map((line, i) => `<text x="32" y="${48 + i * 30}"${i === 0 ? ' font-weight="700"' : ""}>${escapeXml(line)}</text>`).join("")}</g></svg>`;
}
export async function renderPng(board: TaskBoard, locale = "en"): Promise<Buffer> {
	const { Resvg } = await import("@resvg/resvg-js");
	return new Resvg(renderSvg(board, locale)).render().asPng();
}
