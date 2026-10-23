import { createCharacter, markPath } from "../../../brand/src/yonder-mark.js";
import { beginTask, completeStep, emptyState, readState, STORAGE_KEY } from "./state.mjs";

const $ = (selector) => document.querySelector(selector);
const bridge = window.webkit?.messageHandlers?.companion;
const native = Boolean(bridge);
const connected = location.protocol === "http:" && location.pathname !== "/";
document.body.classList.toggle("native", native);
let submitting = false;
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
	$(".pending-dot").hidden = Boolean(state.active?.completed);
	$("#reopen").setAttribute("aria-label", state.active?.completed ? "打开已完成的交互" : "待处理交互，点击展开");
	alignDock();
	$("#reopen").hidden = next || surface === "inline" || !state.active || state.active.completed;
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
function render() {
	const active = state.active;
	if (native) bridge.postMessage({ action: "state", pending: Boolean(active && !active.completed) });
	if (!active) {
		$("#task-context").textContent = "";
		$("#task-title").textContent = "暂无待处理交互";
		$("#choices").replaceChildren();
		$("#note-form").hidden = true;
		showScene("task");
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
	return new Intl.DateTimeFormat("zh-CN", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(at);
}
function renderHistory() {
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
	current: render,
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
		} catch (reason) {
			error(reason);
		} finally {
			syncing = false;
		}
	}
	await syncHost();
	setInterval(syncHost, 1000);
}
