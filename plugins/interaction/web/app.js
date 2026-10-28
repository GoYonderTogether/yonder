import { createCharacter, markPath } from "../../../brand/src/yonder-mark.js";
import { activitySummary, presentActivity } from "./activity.mjs";
import { endedTask, panelGroups, panelState, shortPanelText } from "./panel.mjs";
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
let latestActivity = { agents: [], known: false };
let summaryEnvelope = { availability: "unpublished" };
function renderActivity(data) {
	latestActivity = data;
	if (data.activitySummary) summaryEnvelope = activitySummary(data.activitySummary);
	$("#pin-button").setAttribute("aria-pressed", String(data.pinned));
	$("#pin-button").title = data.pinned ? "取消固定悬浮入口" : "固定悬浮入口";
	$("#pin-button").setAttribute("aria-label", $("#pin-button").title);
	const key = JSON.stringify([data.known, data.agents, summaryEnvelope]);
	if (key !== activityKey) {
		activityKey = key;
		const target = $("#agents");
		target.replaceChildren();
		for (const agent of data.agents) {
			const row = document.createElement("article");
			row.className = "agent-row";
			const presentation = presentActivity(agent, data.known, summaryEnvelope);
			row.dataset.state = presentation.state;
			row.dataset.emphasized = String(presentation.emphasized);
			row.setAttribute("aria-label", `${agent.name} · ${presentation.label} · ${presentation.items}`);
			const header = document.createElement("div");
			header.className = "agent-heading";
			const name = document.createElement("strong");
			name.textContent = agent.name;
			const status = document.createElement("span");
			status.className = "agent-status";
			status.textContent = presentation.label;
			header.append(name, status);
			row.append(header);
			const counts = document.createElement("p");
			counts.className = "context agent-counts";
			counts.textContent = presentation.items;
			row.append(counts);
			for (const task of agent.tasks ?? []) {
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
let panelData = { tasks: [], agents: [] },
	groupMode = "bot",
	expandedTask,
	panelSource;
let boardRequestSerial = 0;
const endedSections = new Set();
function agentIdentity(id) {
	return panelData.agents.find((agent) => agent.id === id) ?? { id, name: id ?? "临时任务（无 BOT 身份）" };
}
function agentAvatar(agent) {
	const avatar = boardNode("span", agent.name.slice(0, 1), "bot-avatar");
	avatar.setAttribute("aria-label", `${agent.name} · 无头像`);
	if (agent.avatarUrl) {
		try {
			const url = new URL(agent.avatarUrl);
			if (!["https:", "http:"].includes(url.protocol)) return avatar;
			const image = document.createElement("img");
			image.alt = "";
			image.referrerPolicy = "no-referrer";
			image.addEventListener("load", () => {
				avatar.classList.add("has-image");
				avatar.setAttribute("aria-label", `${agent.name} · 头像`);
			});
			image.addEventListener("error", () => {
				image.remove();
				avatar.classList.remove("has-image");
				avatar.setAttribute("aria-label", `${agent.name} · 头像加载失败`);
			});
			image.src = url.href;
			avatar.append(image);
		} catch {
			/* Invalid public metadata uses the same honest fallback. */
		}
	}
	return avatar;
}
function boardItems(items, target) {
	for (const item of items) {
		const row = boardNode("div", undefined, "board-item");
		const button = boardNode("button", undefined, "board-task");
		button.type = "button";
		button.dataset.task = item.id;
		button.id = `task-${item.id}`;
		button.setAttribute("aria-expanded", String(expandedTask === item.id));
		button.setAttribute("aria-controls", `task-detail-${item.id}`);
		button.append(
			boardNode("span", panelState(item), `task-state state-${item.state}`),
			boardNode("span", item.title, "task-title"),
		);
		const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		chevron.setAttribute("aria-hidden", "true");
		chevron.innerHTML = '<use href="#i-arrow"/>';
		button.append(chevron);
		button.addEventListener("click", () => {
			expandedTask = expandedTask === item.id ? undefined : item.id;
			renderBoard();
		});
		const detail = boardNode("div", undefined, "task-detail");
		detail.id = `task-detail-${item.id}`;
		detail.setAttribute("role", "region");
		detail.setAttribute("aria-labelledby", button.id);
		detail.hidden = expandedTask !== item.id;
		if (!detail.hidden) {
			detail.append(boardNode("p", item.title, "task-full-title"));
			if (item.state === "waiting-user" || item.state === "blocked")
				detail.append(
					boardNode(
						"p",
						`${item.state === "blocked" ? "具体阻塞" : "所需操作"}：${shortPanelText(item.progress) || "待补充，尚未记录具体内容"}`,
					),
				);
			else detail.append(boardNode("p", shortPanelText(item.progress || item.objective) || "尚未记录进展"));
			const agent = agentIdentity(item.ownerAgent);
			detail.append(boardNode("p", `负责人：${agent.name}`, "context"));
		}
		row.append(button, detail);
		target.append(row);
	}
}
function endedSection(key, label) {
	const sectionKey = `${groupMode}:${key}`;
	const section = boardNode("details", undefined, "ended-section");
	section.dataset.group = key;
	section.open = endedSections.has(sectionKey);
	const summary = boardNode("summary", label);
	summary.dataset.focusKey = `ended-${key}`;
	section.append(summary);
	section.addEventListener("toggle", () => {
		if (section.open) endedSections.add(sectionKey);
		else endedSections.delete(sectionKey);
	});
	return section;
}
function renderBoard(reset = false) {
	if (!board) return;
	const scroll = reset ? 0 : $(".panel-scroll").scrollTop;
	const focused = document.activeElement?.dataset.task;
	const focusKey = document.activeElement?.dataset.focusKey;
	boardVisible = true;
	const target = $("#board-content");
	target.replaceChildren();
	$("#board-back").hidden = true;
	const controls = boardNode("div", undefined, "board-group-controls");
	controls.setAttribute("role", "group");
	controls.setAttribute("aria-label", "任务分组");
	for (const [mode, label] of [
		["bot", "按 BOT"],
		["matter", "按事项"],
	]) {
		const button = boardNode("button", label);
		button.type = "button";
		button.dataset.focusKey = mode;
		button.setAttribute("aria-pressed", String(mode === groupMode));
		button.addEventListener("click", () => {
			groupMode = mode;
			renderBoard();
		});
		controls.append(button);
	}
	target.append(controls);
	const all = panelGroups(panelData.tasks, groupMode);
	target.append(
		boardNode(
			"p",
			`${panelData.tasks.filter((task) => !endedTask(task)).length} 项未结束 · ${panelData.tasks.filter(endedTask).length} 项已结束`,
			"context board-overview",
		),
	);
	const finished = all.filter((group) => group.ended);
	const done = endedSection("done", `已结束 · ${finished.reduce((sum, group) => sum + group.tasks.length, 0)}`);
	for (const group of all) {
		const section = boardNode("section", undefined, "task-group");
		section.dataset.panelGroup = group.key;
		const heading = boardNode("h2", undefined, "bot-heading");
		if (groupMode === "bot") {
			const agent = agentIdentity(group.root.ownerAgent);
			heading.append(agentAvatar(agent), boardNode("strong", agent.name));
		} else heading.append(boardNode("strong", shortPanelText(group.root.title, 60)));
		heading.append(boardNode("span", String(group.tasks.length), "context group-count"));
		section.append(heading);
		const ongoing = group.tasks.filter((task) => !endedTask(task));
		boardItems(group.ended ? group.tasks : ongoing, section);
		const ended = group.tasks.filter(endedTask);
		if (!group.ended && ended.length) {
			const nested = endedSection(`done-${group.key}`, `已结束 · ${ended.length}`);
			boardItems(ended, nested);
			section.append(nested);
		}
		(group.ended ? done : target).append(section);
	}
	if (finished.length) target.append(done);
	if (!all.length) target.append(boardNode("p", "当前可见范围内没有任务", "context"));
	target.append(boardNode("p", "已结束包含已完成、已取消；当前账本没有归档状态。", "context board-boundary"));
	showScene("board");
	$(".panel-scroll").scrollTop = scroll;
	if (focused) $(`[data-task="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
	else if (focusKey) $(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}
async function refreshBoard(show = false) {
	const serial = ++boardRequestSerial;
	const url = new URL("board?view=panel", location.href);
	if (boardId) url.searchParams.set("id", boardId);
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error("任务面板暂不可用");
		const data = await response.json();
		if (serial !== boardRequestSerial) return;
		if (!data.panel) throw new Error("任务面板数据尚未接入");
		const previous = board?.counts.waiting ?? 0;
		board = data.board;
		panelData = data.panel;
		if (boardId) {
			const item = panelData.tasks.find((task) => task.id === (panelData.selectedId ?? boardId));
			if (item) {
				expandedTask = item.id;
				if (endedTask(item)) {
					const group = panelGroups(panelData.tasks, groupMode).find((group) =>
						group.tasks.some((task) => task.id === item.id),
					);
					endedSections.add(`${groupMode}:${group.ended ? "done" : `done-${group.key}`}`);
				}
			}
			boardId = undefined;
		}
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
	} catch (reason) {
		if (serial !== boardRequestSerial) return;
		board = null;
		panelData = { tasks: [], agents: [] };
		expandedTask = undefined;
		$("#board-count").hidden = true;
		$("#board-content").replaceChildren(boardNode("p", reason.message, "context"));
	}
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

async function refreshActivitySummary() {
	if (!connected || native) return; // AppKit fetches the same endpoint on its existing 2s cycle.
	try {
		const response = await fetch(new URL("activity-summary", location.href), { signal: AbortSignal.timeout(1800) });
		if (!response.ok) throw new Error("Activity summary unavailable");
		const next = activitySummary(await response.json());
		if (next.sourceRevision < (summaryEnvelope.sourceRevision ?? -1)) return;
		summaryEnvelope = next;
	} catch {
		summaryEnvelope = { availability: "unavailable" };
	}
	renderActivity(latestActivity);
}
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
				if (panelSource !== data.board.sourceRevision) {
					panelSource = data.board.sourceRevision;
					boardRequestSerial++;
					board = null;
					panelData = { tasks: [], agents: [] };
					expandedTask = undefined;
					endedSections.clear();
					$("#board-content").replaceChildren();
				}
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
			await refreshActivitySummary();
		} catch (reason) {
			error(reason);
		} finally {
			syncing = false;
		}
	}
	await syncHost();
	setInterval(syncHost, 1000);
}
