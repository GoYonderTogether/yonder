export const FOCUS = {
	window: "小窗体验",
	character: "角色动效",
	cards: "交互卡片",
};
export const STORAGE_KEY = "yonder-ui-prototype-v1";
export function emptyState() {
	return { draft: "", choice: null, history: [] };
}
export function readState(raw) {
	if (!raw) return emptyState();
	const value = JSON.parse(raw);
	if (
		!value ||
		typeof value.draft !== "string" ||
		value.draft.length > 2000 ||
		(value.choice !== null && !Object.hasOwn(FOCUS, value.choice)) ||
		!Array.isArray(value.history) ||
		!value.history.every(
			(entry) =>
				entry && ["choice", "note"].includes(entry.kind) && typeof entry.text === "string" && Number.isFinite(entry.at),
		)
	)
		throw new Error("保存内容的格式无法识别，原记录未覆盖。");
	return value;
}
export function recordChoice(state, choice, at) {
	if (!Object.hasOwn(FOCUS, choice)) throw new Error("请选择一个设计重点。");
	if (state.choice === choice) return state;
	return { ...state, choice, history: [{ kind: "choice", text: FOCUS[choice], at }, ...state.history] };
}
export function recordNote(state, text, at) {
	const note = text.trim();
	if (!note || note.length > 2000) throw new Error("请填写 1–2000 字的想法。");
	return { ...state, draft: "", history: [{ kind: "note", text: note, at }, ...state.history] };
}
