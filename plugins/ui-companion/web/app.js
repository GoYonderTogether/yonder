import { createCharacter, markPath } from "../../../brand/src/yonder-mark.js";
import { beginTask, completeStep, emptyState, readState, STORAGE_KEY } from "./state.mjs";

const $ = (selector) => document.querySelector(selector);
const bridge = window.webkit?.messageHandlers?.companion;
const native = Boolean(bridge);
const connected = location.protocol === "http:" && location.pathname !== "/";
document.body.classList.toggle("native", native);
let submitting = false;
let board = null,
	boardId,
	boardRevision = 0,
	boardVisible = false;
const pending = () => Boolean((state.active && !state.active.completed) || board?.counts.waiting);

let scene = "task",
	activityKey = "";
let state = emptyState(),
	storageAvailable = true,
	open = true,
	surface = "window",
	character,
	pose = "idle";
function error(reason) {
	$("#storage-error").hidden = false;
	$("#storage-error").textContent = `无法保存：${reason.message} 请先复制内容。`;
}
try {
	state = readState(localStorage.getItem(connected ? `yonder-ui:${location.pathname}` : STORAGE_KEY));
} catch (reason) {
	storageAvailable = false;
	error(reason);
}
function save(next) {
	if (!storageAvailable) return false;
	try {
		localStorage.setItem(connected ? `yonder-ui:${location.pathname}` : STORAGE_KEY, JSON.stringify(next));
		state = next;
		return true;
	} catch (reason) {
		error(reason);
		return false;
	}
}
for (const mark of document.querySelectorAll(".static-mark"))
	mark.innerHTML = `<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${markPath({ smallCut: true })}"/></svg>`;
const reduced = matchMedia("(prefers-reduced-motion: reduce)"),
	dark = matchMedia("(prefers-color-scheme: dark)");
function draw() {
	character?.destroy();
	document.documentElement.dataset.theme = dark.matches ? "dark" : "light";
	const svg = $("#character"),
		color = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
	if (reduced.matches || surface === "inline") {
		svg.setAttribute("viewBox", "0 0 256 256");
		svg.innerHTML = `<path fill="${color}" fill-rule="evenodd" d="${markPath()}"/>`;
		character = null;
	} else if (open) character = createCharacter(svg, { color, state: pose });
}
function setPose(next) {
	if (pose === next) return;
	pose = next;
	character?.setState(next);
}
for (const media of [reduced, dark]) media.addEventListener("change", draw);
document.addEventListener("visibilitychange", () => (document.hidden ? character?.destroy() : draw()));
function setOpen(next) {
	open = next;
	if (native) {
		bridge.postMessage({ action: next ? "open" : "close" });
		return;
	}
	if (!next && !anchor) placeAway();
	$("#panel").hidden = !next;
	$(".pending-dot").hidden = !pending();
	$("#reopen").setAttribute("aria-label", state.active?.completed ? "打开已完成的交互" : "待处理交互，点击展开");
	alignDock();
	$("#reopen").hidden = next || surface === "inline" || !pending();
	$("#launcher").setAttribute("aria-expanded", String(next));
	if (next) {
		placeAway();
		draw();
	} else character?.destroy();
}
$("#launcher").addEventListener("click", () => setOpen(!open));
$("#reopen").addEventListener("click", () => {
	if (suppressIconClick) {
		suppressIconClick = false;
		return;
	}
	setOpen(true);
});
$("#close").addEventListener("click", () => setOpen(false));
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && surface !== "inline") setOpen(false);
});
window.addEventListener("yonder-visibility", (event) => {
	open = event.detail;
	if (open) draw();
	else character?.destroy();
});
function showScene(next) {
	scene = next;
	for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== `${next}-view`;
	$(".panel-scroll").scrollTop = 0;
}
function summary(target, steps) {
	target.replaceChildren();
	for (const step of steps) {
		const p = document.createElement("p");
		p.textContent = step.answer || "未补充内容";
		target.append(p);
	}
}
for (const event of ["focusin", "focusout"])
	document.addEventListener(event, () =>
		queueMicrotask(() =>
			bridge?.postMessage({
				action: "editing",
				value: Boolean(document.activeElement?.matches("input,textarea,[contenteditable=true]")),
			}),
		),
	);
$("#pin-button").hidden = !native;
$("#pin-button").addEventListener("click", () => bridge?.postMessage({ action: "pin" }));
function renderActivity(data) {
	$("#pin-button").setAttribute("aria-pressed", String(data.pinned));
	$("#pin-button").title = data.pinned ? "取消固定悬浮入口" : "固定悬浮入口";
	$("#pin-button").setAttribute("aria-label", $("#pin-button").title);
	const key = JSON.stringify([data.known, data.agents]);
	if (key !== activityKey) {
		activityKey = key;
		const target = $("#agents");
		target.replaceChildren();
		for (const agent of data.agents) {
			const row = document.createElement("article");
			row.className = "agent-row";
			row.dataset.state = agent.state;
			const header = document.createElement("div");
			header.className = "agent-heading";
			const name = document.createElement("strong");
			name.textContent = agent.name;
			const status = document.createElement("span");
			status.className = "agent-status";
			status.textContent = agent.state === "running" ? "运行中" : agent.state === "waiting" ? "等待交互" : "空闲";
			header.append(name, status);
			row.append(header);
			for (const task of agent.tasks) {
				const content = document.createElement("div");
				content.className = "agent-task";
				if (task.summary) {
					const summary = document.createElement("p");
					summary.textContent = task.summary;
					content.append(summary);
				}
				const detail = document.createElement("small");
				detail.textContent = task.detail;
				content.append(detail);
				if (task.text) {
					const text = document.createElement("p");
					text.className = "agent-output";
					text.textContent = task.text;
					content.append(text);
				}
				row.append(content);
			}
			target.append(row);
		}
		if (!data.known || !data.agents.length) {
			const empty = document.createElement("p");
			empty.className = "context";
			empty.textContent = data.known ? "暂无 Agent" : "运行状态未知";
			target.append(empty);
		}
	}
	if ((!state.active || (state.active.completed && state.active.autoClose)) && ["task", "done"].includes(scene))
		showScene("agents");
	if (scene === "agents") setPose(data.agents.some((agent) => agent.state === "running") ? "work" : "idle");
}
function render() {
	boardVisible = false;
	const active = state.active;
	if (native) bridge.postMessage({ action: "state", pending: pending() });
	if (!active || (native && active.completed && active.autoClose)) {
		$("#task-context").textContent = "";
		$("#task-title").textContent = "暂无待处理交互";
		$("#choices").replaceChildren();
		$("#note-form").hidden = true;
		showScene(native ? "agents" : "task");
		return;
	}
	if (active.completed) {
		$("#done-title").textContent = active.title;
		summary($("#done-summary"), active.steps);
		showScene("done");
		return;
	}
	const card = active.card;
	$("#task-context").textContent = card.title;
	$("#task-title").textContent = card.prompt;
	$("#choices").replaceChildren();
	$("#choices").hidden = card.kind !== "choice";
	$("#note-form").hidden = card.kind !== "form";
	$("#note").value = active.draft;
	for (const option of card.options ?? []) {
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = option.label;
		button.disabled = !storageAvailable;
		button.addEventListener("click", () => finish(option.id));
		$("#choices").append(button);
	}
	$("#finish").disabled = !storageAvailable;
	showScene("task");
}
async function finish(answer) {
	if (submitting) return;
	submitting = true;
	try {
		const current = state.active;
		const next = completeStep(state, answer, Date.now());
		if (connected) {
			const response = await fetch(new URL("answer", location.href), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: current.id, answer, step: current.steps.length }),
			});
			if (!response.ok) throw new Error(await response.text());
		}
		if (!save(next)) return;
		setPose("done");
		render();
		const active = state.active;
		$("#announcement").textContent = active.completed ? "已完成" : "已记录，继续下一步";
		window.dispatchEvent(
			new CustomEvent("yonder-interaction", {
				detail: { id: active.id, step: active.steps.at(-1), completed: active.completed },
			}),
		);
		if (state.active === active && active.completed && active.autoClose && surface !== "inline") setOpen(false);
	} catch (reason) {
		error(reason);
	} finally {
		submitting = false;
	}
}
$("#note").addEventListener("focus", () => setPose("listen"));
$("#note").addEventListener("blur", () => setPose("idle"));
$("#note").addEventListener("input", (event) =>
	save({ ...state, active: { ...state.active, draft: event.target.value } }),
);
$("#note-form").addEventListener("submit", (event) => {
	event.preventDefault();
	finish($("#note").value.trim());
});
function time(at) {
	return new Intl.DateTimeFormat(window.yonderSettings?.locale ?? "zh-CN", {
		timeZone: window.yonderSettings?.timezone ?? "Asia/Shanghai",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(at);
}
function renderHistory() {
	boardVisible = false;
	const target = $("#history");
	target.replaceChildren();
	for (const session of [state.active, ...state.sessions].filter(Boolean)) {
		const button = document.createElement("button");
		button.className = "history-entry";
		button.type = "button";
		const title = document.createElement("strong");
		title.textContent = session.title;
		const detail = document.createElement("small");
		detail.textContent = `${session.completed ? "已完成" : "进行中"} · ${session.steps.length} 次交互${session.steps.length ? ` · ${time(session.steps.at(-1).at)}` : ""}`;
		button.append(title, detail);
		button.addEventListener("click", () => replay(session));
		target.append(button);
	}
	// Earlier prototypes stored ungrouped events. Keep them readable without inventing missing windows.
	for (const entry of state.history) {
		const p = document.createElement("p");
		p.className = "legacy";
		p.textContent = `${entry.text} · ${time(entry.at)}`;
		target.append(p);
	}
	showScene("history");
}
function replay(session) {
	$("#replay-title").textContent = session.title;
	const target = $("#replay");
	target.replaceChildren();
	for (const [index, step] of session.steps.entries()) {
		const detail = document.createElement("details");
		detail.open = index === session.steps.length - 1;
		const heading = document.createElement("summary");
		heading.textContent = `${index + 1}. ${step.card.prompt}`;
		const options = document.createElement("p");
		options.className = "context";
		options.textContent = step.card.options?.map((o) => o.label).join(" / ") ?? "填写内容";
		const answer = document.createElement("p");
		answer.className = "replay-answer";
		answer.textContent = step.answer || "未补充内容";
		const stamp = document.createElement("time");
		stamp.textContent = time(step.at);
		detail.append(heading, options, answer, stamp);
		target.append(detail);
	}
	if (!session.completed) {
		const p = document.createElement("p");
		p.textContent = `等待处理：${session.card.prompt}`;
		target.append(p);
		if (session.draft) {
			const draft = document.createElement("p");
			draft.textContent = session.draft;
			target.append(draft);
		}
	}
	showScene("replay");
}
function boardNode(tag, text, className) {
	const node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
}
function boardItems(items, target, groupIds) {
	for (const item of items) {
		const row = boardNode("div", undefined, "board-item");
		const button = boardNode("button", `${item.ref} ${item.title}`, "board-task");
		button.type = "button";
		button.dataset.task = item.id;
		button.addEventListener("click", () => {
			boardId = item.id;
			refreshBoard(true).catch(error);
		});
		row.append(
			button,
			boardNode(
				"p",
				`${item.state} · ${item.ownerAgent ?? "—"} · ${item.acceptance.met}/${item.acceptance.total}`,
				"context",
			),
			boardNode(
				"p",
				`${Math.floor(item.elapsedMs / 60000)}m · ${Math.floor(item.idleMs / 60000)}m 未更新${item.stalled ? " · 长时间无进展" : ""}`,
				item.stalled ? "board-stalled" : "context",
			),
		);
		const nested = groupIds ? item.children.filter((child) => groupIds.has(child.id)) : item.children;
		if (nested.length) {
			const children = boardNode("div", undefined, "board-children");
			boardItems(nested, children, groupIds);
			row.append(children);
		}
		target.append(row);
	}
}
function renderBoard(reset = false) {
	if (!board) return;
	const scroll = reset ? 0 : $(".panel-scroll").scrollTop;
	const focused = document.activeElement?.dataset.task;
	boardVisible = true;
	const target = $("#board-content");
	const expanded = [...target.querySelectorAll("details[open]")].map((node) => node.dataset.group);
	target.replaceChildren();
	$("#board-back").hidden = !board.detail;
	const counts = board.counts;
	target.append(
		boardNode("p", `${counts.waiting} 等你 · ${counts.inProgress} 进行中 · ${counts.blocked} 阻塞`, "context"),
	);
	if (board.detail) {
		const { task, history, children } = board.detail;
		target.append(boardNode("h2", `${task.ref} ${task.title}`), boardNode("p", task.objective));
		const acceptance = boardNode("ol");
		for (const [index, point] of task.acceptance.entries()) {
			const item = boardNode("li", point);
			item.append(boardNode("p", task.evidence[index] ?? "—", "context"));
			acceptance.append(item);
		}
		target.append(
			acceptance,
			boardNode("h2", "交付"),
			boardNode("p", task.deliverable ?? "—"),
			boardNode("h2", "事件时间线"),
		);
		for (const event of history)
			target.append(
				boardNode(
					"p",
					`${event.at} · ${event.kind}
${JSON.stringify(event.data)}`,
					"board-event",
				),
			);
		if (children.length) {
			target.append(boardNode("h2", "子任务"));
			boardItems(children, target);
		}
	} else {
		const labels = { waiting: "等你", inProgress: "进行中", blocked: "阻塞", done: "刚完成" };
		for (const group of board.groups) {
			const section = boardNode(group.id === "done" ? "details" : "section");
			section.dataset.group = group.id;
			if (group.id === "done") section.open = expanded.includes(group.id);
			section.append(boardNode(group.id === "done" ? "summary" : "h2", `${labels[group.id]} · ${group.items.length}`));
			const groupIds = new Set(group.items.map((item) => item.id));
			boardItems(
				group.items.filter((item) => !groupIds.has(item.parent)),
				section,
				groupIds,
			);
			target.append(section);
		}
	}
	showScene("board");
	$(".panel-scroll").scrollTop = scroll;
	if (!reset && focused) $(`[data-task="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}
async function refreshBoard(show = false) {
	const url = new URL("board", location.href);
	if (boardId) url.searchParams.set("id", boardId);
	const response = await fetch(url);
	if (!response.ok) throw new Error(await response.text());
	const previous = board?.counts.waiting ?? 0;
	board = (await response.json()).board;
	$("#board-button").hidden = false;
	$("#board-count").textContent = board.counts.waiting;
	$("#board-count").hidden = !board.counts.waiting;
	$(".pending-dot").hidden = !pending();
	if (native) {
		bridge.postMessage({ action: "state", pending: pending() });
		if (board.counts.waiting > previous) bridge.postMessage({ action: "attention" });
	} else if (!open) $("#reopen").hidden = surface === "inline" || !pending();
	if (show || boardVisible) renderBoard(show);
	if (show) setOpen(true);
}
$("#board-button").addEventListener("click", () => {
	boardId = undefined;
	refreshBoard(true).catch(error);
});
$("#board-back").addEventListener("click", () => {
	boardId = undefined;
	refreshBoard(true).catch(error);
});
$("#history-button").addEventListener("click", renderHistory);
$("#history-back").addEventListener("click", render);
$("#replay-back").addEventListener("click", renderHistory);
let mouse = { x: innerWidth / 2, y: innerHeight / 2 },
	drag = null,
	anchor = null,
	iconDrag = null,
	suppressIconClick = false;
const panel = $("#panel");
function panelSize() {
	const css = getComputedStyle(panel);
	return { w: panel.offsetWidth || parseFloat(css.width), h: panel.offsetHeight || parseFloat(css.height) };
}
function position(x, y) {
	const { w, h } = panelSize();
	x = Math.max(8, Math.min(x, innerWidth - w - 8));
	y = Math.max(8, Math.min(y, innerHeight - h - 8));
	panel.style.left = `${x}px`;
	panel.style.top = `${y}px`;
	const right = x + w / 2 > innerWidth / 2,
		bottom = y + h / 2 > innerHeight / 2;
	anchor = { x: right ? x + w : x, y: bottom ? y + h : y, right, bottom };
	alignDock();
}
function alignDock() {
	if (!anchor || native || surface === "inline") return;
	const icon = $("#reopen");
	icon.style.left = `${anchor.right ? anchor.x - 56 : anchor.x}px`;
	icon.style.top = `${anchor.bottom ? anchor.y - 56 : anchor.y}px`;
	icon.style.right = "auto";
	icon.style.bottom = "auto";
}
function placeAway() {
	if (native || surface === "inline") return;
	const { w, h } = panelSize();
	if (anchor) {
		position(anchor.right ? anchor.x - w : anchor.x, anchor.bottom ? anchor.y - h : anchor.y);
		return;
	}
	const corners = [
		{ x: 16, y: 64 },
		{ x: innerWidth - w - 16, y: 64 },
		{ x: 16, y: innerHeight - h - 16 },
		{ x: innerWidth - w - 16, y: innerHeight - h - 16 },
	];
	corners.sort(
		(a, b) =>
			Math.hypot(b.x + w / 2 - mouse.x, b.y + h / 2 - mouse.y) -
			Math.hypot(a.x + w / 2 - mouse.x, a.y + h / 2 - mouse.y),
	);
	position(corners[0].x, corners[0].y);
}
const dockButton = $("#reopen");
dockButton.addEventListener("pointerdown", (event) => {
	if (event.button !== 0) return;
	const r = dockButton.getBoundingClientRect();
	iconDrag = { x: event.clientX, y: event.clientY, left: r.left, top: r.top };
	suppressIconClick = false;
	dockButton.setPointerCapture(event.pointerId);
});
dockButton.addEventListener("pointermove", (event) => {
	if (!iconDrag) return;
	const dx = event.clientX - iconDrag.x,
		dy = event.clientY - iconDrag.y;
	if (Math.hypot(dx, dy) < 3) return;
	suppressIconClick = true;
	const x = iconDrag.left + dx,
		y = iconDrag.top + dy,
		{ w, h } = panelSize(),
		right = x + 28 > innerWidth / 2,
		bottom = y + 28 > innerHeight / 2;
	position(right ? x + 56 - w : x, bottom ? y + 56 - h : y);
});
for (const name of ["pointerup", "pointercancel"])
	dockButton.addEventListener(name, () => {
		iconDrag = null;
	});
document.addEventListener("pointermove", (event) => {
	mouse = { x: event.clientX, y: event.clientY };
});
panel.addEventListener("pointerdown", (event) => {
	if (
		surface === "inline" ||
		event.button !== 0 ||
		event.target.closest("button,a,input,textarea,select,summary,[data-selectable]")
	)
		return;
	event.preventDefault();
	const rect = panel.getBoundingClientRect();
	drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
	panel.setPointerCapture(event.pointerId);
	bridge?.postMessage({ action: "drag-start" });
});
panel.addEventListener("pointermove", (event) => {
	if (!drag) return;
	if (native) bridge.postMessage({ action: "drag-move" });
	else position(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
});
function endDrag() {
	drag = null;
	bridge?.postMessage({ action: "drag-end" });
}
panel.addEventListener("pointerup", endDrag);
panel.addEventListener("pointercancel", endDrag);
window.addEventListener("resize", () => {
	if (!native && surface !== "inline" && open) {
		const r = panel.getBoundingClientRect();
		position(r.left, r.top);
	}
});
function setSurface(next) {
	if (!["window", "notice", "inline"].includes(next)) throw new Error("未知承载方式");
	surface = native ? "window" : next;
	document.body.dataset.surface = surface;
	render();
	if (surface === "inline") {
		panel.style.left = "";
		panel.style.top = "";
	}
	for (const a of document.querySelectorAll(".preview-bar a"))
		a.setAttribute("aria-current", a.hash === `#${surface}` ? "page" : "false");
	if (surface === "notice") setOpen(false);
	else {
		if (!native) setOpen(true);
		draw();
	}
}
window.addEventListener("hashchange", () => setSurface(location.hash.slice(1) || "window"));
// The trusted plugin host supplies cards; model answers return through the originating tool context.
window.yonderUI = {
	activity: renderActivity,
	present(card) {
		const next = beginTask(state, card, crypto.randomUUID());
		if (!save(next)) return false;
		render();
		setPose("idle");
		if (native) bridge.postMessage({ action: "attention" });
		else if (surface === "notice") setOpen(false);
		else setOpen(true);
		return true;
	},
	setSurface,
	history: renderHistory,
	current() {
		if (board && boardVisible) renderBoard();
		else render();
	},
};
render();
setSurface(location.hash.slice(1) || "window");
if (surface !== "inline" && (!state.active || (state.active.completed && state.active.autoClose))) setOpen(false);
draw();

if (connected) {
	document.querySelector(".preview-bar").hidden = true;
	let syncing = false;
	async function syncHost() {
		if (syncing || submitting) return;
		syncing = true;
		try {
			const response = await fetch(new URL("state", location.href));
			if (!response.ok) throw new Error(await response.text());
			const data = await response.json();
			if (submitting) return;
			const showBoard = data.board && data.board.revision !== boardRevision;
			if (showBoard) {
				boardId = data.board.id;
				boardRevision = data.board.revision;
			}
			state.sessions = data.history.filter((item) => item.id !== state.active?.id);
			if (data.active && state.active?.id !== data.active.id) {
				const next = beginTask(state, data.active.card, data.active.id);
				next.active = data.active;
				if (save(next)) {
					render();
					setPose("idle");
					if (native) bridge.postMessage({ action: "attention" });
					else setOpen(surface !== "notice");
				}
			} else if (data.active && !state.active?.completed && data.active.steps.length !== state.active.steps.length) {
				if (save({ ...state, active: data.active })) render();
			} else if (!data.active) {
				const completed =
					data.history.find((item) => item.id === state.active?.id && item.completed) ??
					(!state.active ? data.history.findLast((item) => item.completed) : null);
				if (completed && !state.active?.completed) {
					if (
						save({ ...state, active: completed, sessions: data.history.filter((item) => item.id !== completed.id) })
					) {
						render();
						if (completed.autoClose && surface !== "inline") setOpen(false);
					}
				} else if (state.active && !state.active.completed) {
					if (save({ ...state, active: null })) {
						render();
						if (surface !== "inline") setOpen(false);
					}
				}
			}
			if (data.board) await refreshBoard(showBoard);
		} catch (reason) {
			error(reason);
		} finally {
			syncing = false;
		}
	}
	await syncHost();
	setInterval(syncHost, 1000);
}
