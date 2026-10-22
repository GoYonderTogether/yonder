import { createCharacter, markPath } from "../../brand/src/yonder-mark.js";
import { emptyState, FOCUS, readState, recordChoice, recordNote, STORAGE_KEY } from "./state.mjs";

const $ = (selector) => document.querySelector(selector);
const bridge = window.webkit?.messageHandlers?.companion;
const isNative = Boolean(bridge);
document.body.classList.toggle("native", isNative);
let state = emptyState();
let storageAvailable = true;
function reportError(error) {
	$("#storage-error").hidden = false;
	$("#storage-error").textContent = `无法保存：${error.message} 请先复制你的内容。`;
}
try {
	state = readState(localStorage.getItem(STORAGE_KEY));
} catch (error) {
	storageAvailable = false;
	reportError(error);
}
function save(next) {
	if (!storageAvailable) return false;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		state = next;
		return true;
	} catch (error) {
		reportError(error);
		return false;
	}
}
for (const mark of document.querySelectorAll(".static-mark")) {
	mark.innerHTML = `<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${markPath({ smallCut: true })}"/></svg>`;
}
let character;
let pose = "idle";
let open = true;
let pinned = false;
let scene = state.draft && state.choice ? "compose" : "choice";
let returnScene = scene;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const darkMode = matchMedia("(prefers-color-scheme: dark)");
function drawCharacter() {
	character?.destroy();
	document.documentElement.dataset.theme = darkMode.matches ? "dark" : "light";
	const svg = $("#character");
	const color = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
	if (reducedMotion.matches) {
		svg.setAttribute("viewBox", "0 0 256 256");
		svg.innerHTML = `<path fill="${color}" fill-rule="evenodd" d="${markPath()}"/>`;
		character = null;
	} else if (open) {
		character = createCharacter(svg, { color, state: pose });
	}
}
function setPose(next) {
	pose = next;
	character?.setState(next);
}
drawCharacter();
for (const media of [reducedMotion, darkMode]) media.addEventListener("change", drawCharacter);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) character?.destroy();
	else drawCharacter();
});
$("#character-button").addEventListener("click", () => {
	const poses = ["idle", "listen", "work", "done", "sleep"];
	setPose(poses[(poses.indexOf(pose) + 1) % poses.length]);
});
function setMenu(visible) {
	$("#more-menu").hidden = !visible;
	$("#more").setAttribute("aria-expanded", String(visible));
}
function setOpen(next) {
	open = next;
	setMenu(false);
	if (isNative) {
		bridge.postMessage({ action: next ? "open" : "close" });
		return;
	}
	$("#panel").hidden = !next;
	$("#reopen").hidden = next;
	$("#launcher").setAttribute("aria-expanded", String(next));
	$("#launcher").setAttribute("aria-label", next ? "收起 Yonder" : "打开 Yonder");
	if (next) {
		drawCharacter();
		$("#close").focus();
	} else {
		character?.destroy();
		$("#launcher").focus();
	}
}
$("#launcher").addEventListener("click", () => setOpen(!open));
$("#reopen").addEventListener("click", () => setOpen(true));
$("#close").addEventListener("click", () => setOpen(false));
$("#more").addEventListener("click", () => setMenu($("#more-menu").hidden));
$("#pin").addEventListener("click", () => {
	pinned = !pinned;
	$("#pin").setAttribute("aria-pressed", String(pinned));
	bridge?.postMessage({ action: "pin", value: pinned });
	setMenu(false);
	$("#more").focus();
});
document.addEventListener("keydown", (event) => {
	if (event.key !== "Escape") return;
	if (!$("#more-menu").hidden) {
		setMenu(false);
		$("#more").focus();
	} else setOpen(false);
});
document.addEventListener("pointerdown", (event) => {
	if (!event.target.closest(".more-menu,#more")) setMenu(false);
	if (!isNative && open && !pinned && !event.target.closest(".panel,.preview-bar,.reopen")) setOpen(false);
});
window.addEventListener("yonder-visibility", (event) => {
	open = event.detail;
	if (open) drawCharacter();
	else character?.destroy();
});
function showScene(next, focus = true) {
	scene = next;
	setMenu(false);
	for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== `${next}-view`;
	$("#chosen-title").textContent = state.choice ? `先打磨${FOCUS[state.choice]}。` : "补充一个想法";
	$(".panel-scroll").scrollTop = 0;
	const heading = $(`#${next}-view h1`);
	heading.tabIndex = -1;
	if (focus) heading.focus({ preventScroll: true });
}
showScene(scene, false);
for (const button of document.querySelectorAll("[data-choice]")) {
	button.disabled = !storageAvailable;
	button.addEventListener("click", () => {
		if (!save(recordChoice(state, button.dataset.choice, Date.now()))) return;
		setPose("done");
		showScene("compose");
		$("#announcement").textContent = `已选择${FOCUS[state.choice]}`;
	});
}
$("#change-choice").addEventListener("click", () => {
	setPose("idle");
	showScene("choice");
});
const note = $("#note");
note.value = state.draft;
$("#finish").disabled = !storageAvailable;
note.addEventListener("focus", () => setPose("listen"));
note.addEventListener("blur", () => setPose("idle"));
note.addEventListener("input", () => save({ ...state, draft: note.value }));
$("#note-form").addEventListener("submit", (event) => {
	event.preventDefault();
	if (note.value.trim()) {
		if (!save(recordNote(state, note.value, Date.now()))) return;
	} else if (!save({ ...state, draft: "" })) return;
	note.value = "";
	$("#announcement").textContent = "已保存";
	setPose("idle");
	showScene("choice", false);
	setOpen(false);
});
function renderHistory() {
	const history = $("#history");
	history.replaceChildren();
	if (!state.history.length) {
		const empty = document.createElement("p");
		empty.className = "empty";
		empty.textContent = "还没有记录。先做一个选择吧。";
		history.append(empty);
	}
	for (const entry of state.history) {
		const article = document.createElement("article");
		const text = document.createElement("p");
		text.textContent = entry.text;
		const time = document.createElement("time");
		time.dateTime = new Date(entry.at).toISOString();
		time.textContent = new Intl.DateTimeFormat("zh-CN", {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		}).format(entry.at);
		article.append(text, time);
		history.append(article);
	}
}
for (const [id, view] of [
	["#saved", "history"],
	["#about", "read"],
]) {
	$(id).addEventListener("click", () => {
		if (scene === "choice" || scene === "compose") returnScene = scene;
		renderHistory();
		showScene(view);
	});
}
for (const button of document.querySelectorAll(".return"))
	button.addEventListener("click", () => showScene(returnScene));
