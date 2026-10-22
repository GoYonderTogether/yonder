import assert from "node:assert/strict";
import { emptyState, readState, recordChoice, recordNote } from "./state.mjs";

const draft = { ...emptyState(), draft: "收起后，保留我没写完的反馈。" };
assert.deepEqual(readState(JSON.stringify(draft)), draft, "重开原型不能丢失草稿");
const choice = recordChoice(draft, "character", 1);
assert.equal(recordChoice(choice, "character", 2).history.length, 1, "重复选择不能重复记录");
assert.equal(choice.draft, draft.draft, "选择卡片不能清空反馈草稿");
const note = recordNote(choice, "  保留双星角色  ", 3);
assert.equal(note.draft, "");
assert.equal(note.history[0].text, "保留双星角色");
assert.equal(note.history[1].kind, "choice");
assert.deepEqual(readState(JSON.stringify(note)), note, "重启后保留记录与选择");
assert.throws(() => recordChoice(note, "constructor", 4));
assert.throws(() => recordNote(note, "  ", 4));
assert.throws(() => readState('{"draft":42}'), /原记录未覆盖/);
assert.throws(() => readState("broken"));
console.log("Prototype state check passed: draft recovery, selection dedupe, note persistence, invalid input.");
