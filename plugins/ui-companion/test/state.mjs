import assert from "node:assert/strict";
import { beginTask, completeStep, emptyState, readState, validateCard } from "../web/state.mjs";

const initialTask = {
	id: "ui-review",
	title: "界面确认",
	prompt: "选择验收项",
	kind: "choice",
	options: [
		{ id: "cards", label: "交互卡片" },
		{ id: "window", label: "窗口" },
	],
	next: { id: "feedback", title: "界面确认", prompt: "验收反馈", kind: "form" },
};
let state = beginTask(emptyState(), initialTask, "task-1");
state = completeStep(state, "cards", 1);
assert.equal(state.active.completed, false, "有下一步时不能提前完成");
assert.equal(state.active.card.kind, "form");
state = { ...state, active: { ...state.active, draft: "未写完的内容" } };
assert.deepEqual(readState(JSON.stringify(state)), state, "重开保留当前窗口和草稿");
state = completeStep(state, "收敛操作入口", 2);
assert.equal(state.active.autoClose, true, "默认完成后收起");
assert.equal(state.active.completed, true);
assert.equal(state.active.steps[0].answer, "交互卡片");
assert.equal(state.active.steps[1].answer, "收敛操作入口");
assert.throws(() => completeStep(state, "重复完成", 3));
state = beginTask(state, { ...initialTask, autoClose: false, next: undefined }, "task-2");
state = completeStep(state, "window", 3);
assert.equal(state.active.autoClose, false, "宿主可要求完成后保留");
assert.equal(state.sessions[0].steps.length, 2, "历史保留完整步骤和原卡片");
assert.equal(readState(JSON.stringify({ draft: "旧草稿", choice: null, history: [] })).draft, "旧草稿");
assert.throws(() => validateCard({ ...initialTask, autoClose: "false" }));
assert.throws(() =>
	validateCard({
		...initialTask,
		options: [
			{ id: "a", label: "一" },
			{ id: "a", label: "二" },
		],
	}),
);
assert.throws(() => readState('{"draft":42}'));
assert.throws(() => completeStep(beginTask(emptyState(), initialTask, "bad"), "unknown", 4));
console.log(
	"Passed: next step, default close, host keep-open, draft recovery, history snapshots, legacy data, input validation.",
);
