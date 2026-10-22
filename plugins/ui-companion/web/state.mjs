export const STORAGE_KEY = "yonder-ui-prototype-v1";
export function validateCard(value, depth = 0) {
	if (
		depth > 12 ||
		!value ||
		typeof value !== "object" ||
		typeof value.id !== "string" ||
		!value.id ||
		typeof value.title !== "string" ||
		typeof value.prompt !== "string" ||
		!["choice", "form"].includes(value.kind)
	)
		throw new Error("交互内容格式无效。");
	if (value.autoClose !== undefined && typeof value.autoClose !== "boolean")
		throw new Error("autoClose 必须是布尔值。");
	if (
		value.kind === "choice" &&
		(!Array.isArray(value.options) ||
			!value.options.length ||
			value.options.some((o) => !o || typeof o.id !== "string" || !o.id || typeof o.label !== "string") ||
			new Set(value.options.map((o) => o.id)).size !== value.options.length)
	)
		throw new Error("选项格式无效。");
	if (value.next !== undefined) validateCard(value.next, depth + 1);
	return JSON.parse(JSON.stringify(value));
}
export function emptyState() {
	return { draft: "", choice: null, history: [], sessions: [], active: null };
}
export function readState(raw) {
	if (!raw) return emptyState();
	const value = JSON.parse(raw);
	if (!value || typeof value.draft !== "string" || !Array.isArray(value.history))
		throw new Error("保存内容无法识别，原记录未覆盖。");
	for (const entry of value.history) {
		if (!entry || typeof entry.text !== "string" || !Number.isFinite(entry.at))
			throw new Error("历史记录无法识别，原记录未覆盖。");
	}
	const state = { ...emptyState(), ...value };
	if (!Array.isArray(state.sessions)) throw new Error("交互历史无法识别，原记录未覆盖。");
	for (const session of [...state.sessions, ...(state.active ? [state.active] : [])]) {
		if (
			!session ||
			typeof session.id !== "string" ||
			typeof session.title !== "string" ||
			!Array.isArray(session.steps) ||
			typeof session.draft !== "string" ||
			typeof session.completed !== "boolean" ||
			typeof session.autoClose !== "boolean"
		)
			throw new Error("交互记录无法识别，原记录未覆盖。");
		validateCard(session.card);
		for (const step of session.steps) {
			validateCard(step.card);
			if (typeof step.answer !== "string" || !Number.isFinite(step.at))
				throw new Error("交互步骤无法识别，原记录未覆盖。");
		}
	}
	return state;
}
export function beginTask(state, card, id) {
	const validated = validateCard(card);
	return {
		...state,
		sessions: state.active ? [state.active, ...state.sessions] : state.sessions,
		active: {
			id,
			title: validated.title,
			card: validated,
			steps: [],
			draft: "",
			completed: false,
			autoClose: validated.autoClose ?? true,
		},
	};
}
export function completeStep(state, answer, at) {
	const active = state.active;
	if (!active || active.completed) throw new Error("该交互已完成。");
	const card = active.card;
	let label = answer;
	if (card.kind === "choice") {
		const option = card.options.find((o) => o.id === answer);
		if (!option) throw new Error("请选择有效选项。");
		label = option.label;
	} else if (typeof answer !== "string" || answer.length > 2000) throw new Error("想法不能超过 2000 字。");
	const steps = [...active.steps, { card, value: answer, answer: label, at }];
	const next = card.next;
	return {
		...state,
		active: {
			...active,
			steps,
			draft: "",
			card: next ?? card,
			completed: !next,
			autoClose: next?.autoClose ?? card.autoClose ?? active.autoClose,
		},
	};
}
