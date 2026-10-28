> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-hashline-edit-pro — 注入模型的提示词原文

- 包: `pi-hashline-edit-pro` 7.1.1
- License: MIT (Copyright (c) 2026 RimuruW and Yugimob) — `~/.pi/agent/npm/node_modules/pi-hashline-edit-pro/LICENSE`
- 仓库: https://github.com/YuGiMob/pi-hashline-edit-pro
- 来源: `%s/tool-prompts/*.md`，由 `src/prompts.ts` 的 `loadP()/loadGuide()/loadGuidelines()` 读取；`<name>.md`=工具 description，`<name>-snippet.md`=promptSnippet，`<name>-guidelines.md`=promptGuidelines（每行 `- ` 一条）

## tool-prompts/read.md

```
Read a text file as `anchor│content` rows: a 5-character lowercase anchor (letters only), `│`, then the line. Target edits by anchor, never by content or line number. `offset` takes a 1-indexed line number or a served anchor; with an anchor, `limit` counts lines from that anchor row onward — no line-number math. Page long files with `offset` and `limit`; when output says truncated, continue from the hinted `offset`. A stale anchor is refused with the current rows and fresh anchors. Images attach visually; binary, directory, and UTF-16/UTF-32 text are rejected; an empty file returns one empty row you can replace to seed content.
```

## tool-prompts/read-snippet.md

```
Read a file; each line returned as anchor│content
```

## tool-prompts/read-guidelines.md

```
- `read`: call again after an edit when you need anchors you lack — post-edit diff `+`/` ` rows and served `anchor│content` rows already carry fresh anchors for the changed range.
- `read`: an auto-read-all outline row is the first line of a symbol's declaration, and a `[limit N]` line under it is the span to request; a row clipped with a trailing `...` is not served for editing.
- `read`: `replace_match` needs both boundary lines served; copy `match` from a served row or read the lines first.
```

## tool-prompts/outline.md

```
Return the symbols of a file, a directory, or a glob such as `src/**/*.ts`: one `anchor│content` row per symbol, where the content is the real first line of that symbol's declaration. Use it before reading a large or unfamiliar file or module, then read only the spans you need.

Each file starts with a `=== path (language) — N lines ===` header. A `[limit N]` line under a row is that symbol's span: `read` with `offset` set to the row's anchor and `limit` set to N returns exactly that symbol. A `[N nested]` line marks children hidden by `depth`. Output stops at 400 rows, and the footer says how to continue. A directory or glob covers supported files only, skips ignored folders, and gives each file a share of the rows; `*` and `**` both cross folders. Files over 200KB are skipped, and a batch stops once it has read 400,000 source lines to protect the session's anchors.

Supported languages: JavaScript, TypeScript, JSX/TSX, Python, Go, Rust, Solidity, Java, PHP, Blade, SCSS, Sass, and Markdown. Any other file, or a file with no symbols, comes back as a head-and-tail preview with a note that says so; an empty file keeps only its empty-file note. A note also says when the parser could not read part of a file, since symbols there may be missing.

A row is only the declaration line: read a symbol's span before you edit inside it. Rows cover top-level declarations and the members of a type or module; a declaration inside a function body is never a row, whatever `depth` you pass. Annotations, decorators, and attributes above a declaration are not shown and are outside its span. A row clipped with a trailing `...` is not served for editing, so read that line first.
```

## tool-prompts/outline-snippet.md

```
Map the symbols of a file or folder before reading it: one anchored row per declaration, with the span to read
```

## tool-prompts/outline-guidelines.md

```
- `outline`: before you `read` a large or unfamiliar file or module, outline it and read only the spans you need.
- `outline`: a span starts at the declaration line; read the lines above it before you delete or move a symbol, so its decorators go with it.
```

## tool-prompts/replace.md

```
Replace a range of lines (or a single line) in a text file by anchor. Deleting every line empties the file, and the result names the empty-line anchor, so a follow-up `replace` can seed content without a `read`.

To change only part of a line without retyping the rest, use `replace_match` instead; it preserves every character the request does not name.
```

## tool-prompts/replace-snippet.md

```
Replace lines by anchor: bare anchors in `remove_from`/`remove_to`, the exact replacement text in `text`
```

## tool-prompts/replace-guidelines.md

```
- `replace`: same-message calls must target disjoint ranges.
- `replace`: a pure deletion (`text: ""`) is the cheap way to clear a large range: it verifies only the first and last line against the served record and removes the interior as it currently stands.
- `replace`: for a single line, use the same anchor for `remove_from` and `remove_to`.
```

## tool-prompts/replace-match.md

```
Replace part of a line — or the same fragment on several lines of a range — without retyping the rest. `match` is the exact text to find inside the anchored range, and `replacement` replaces every occurrence; the text around each match is left untouched. `match` stays within one line, while `replacement` may span lines (a single trailing line break is its terminator); new lines inherit the file's line endings. Send only the fragment that changes — never text that `replacement` leaves unchanged — and narrow `replace_from`/`replace_to` when only one occurrence should change. For a whole-line rewrite, use `replace` with the same anchors.

The two boundary anchors must still match what was last shown; lines strictly inside the range are searched as they are on disk.
```

## tool-prompts/replace-match-snippet.md

```
Replace part of a line or range by anchor: every `match` occurrence inside the range becomes `replacement` (which may span lines); the text around each match stays untouched
```

## tool-prompts/replace-match-guidelines.md

```
- `replace_match`: `match` is only the fragment that changes — never text that `replacement` leaves unchanged; every occurrence inside the range is replaced, so narrow the anchors when only some lines should change.
- `replace_match`: the anchors bound the range searched; `match` must stay within one line, while `replacement` may span lines — a trailing line break is the line's terminator, interior breaks split the replacement into lines, and a lone break counts as empty.
- `replace_match`: when the change covers the whole line, use `replace` with the same anchor and the exact text.
```

## tool-prompts/insert.md

```
Insert text next to an existing line without removing anything. The anchor line stays in place, and `anchor` is a bare 5-character anchor from any served `anchor│content` row.
```

## tool-prompts/insert-snippet.md

```
Insert a text block after or before an anchor line: the anchor line stays; `text` is the exact text without anchor prefixes
```

## tool-prompts/insert-guidelines.md

```
- `insert`: a missing or extra `+anchor│` blank row at either block edge in the diff is the classic insert slip.
```

## tool-prompts/copy.md

```
Duplicate a range of lines at another anchor. The source rows and anchors stay live; the copied lines get fresh anchors in the destination's post-edit diff and keep their source line endings.

A copy duplicates the content its source anchors were served from, so a same-message edit to the source file does not change what is copied.
```

## tool-prompts/copy-snippet.md

```
Copy lines to another position by anchor: `source_from`/`source_to` mark the range, `anchor` and `direction` the destination
```

## tool-prompts/copy-guidelines.md

```
- `copy`: the same anchor in `source_from` and `source_to` copies one line.
```

## tool-prompts/move.md

```
Relocate a range of lines to another anchor. Within one file the destination must sit outside the source range. Rows between the source and the destination keep their content but may be re-anchored, so read that span again if you plan to edit it.

A cross-file move whose source file also gets other edits in the same message runs outside any batch: same-message edits to its destination file can then either abort or make the move fail, so send that move in a separate message.
```

## tool-prompts/move-snippet.md

```
Move lines to another position by anchor: `source_from`/`source_to` mark the range, `anchor` and `direction` the destination
```

## tool-prompts/move-guidelines.md

```
- `move`: moving a range to where it already sits reports `No changes made` and leaves the anchors alone.
```

## tool-prompts/transfer-guidelines.md

```
- `copy`/`move`: only the first and last marker rows and the destination line need anchors — grep the markers, the body is copied; to append to the end of a file, anchor that file's last line with `direction: "after"`.
- `copy`/`move`: within one file the insertion point must fall before the source range's first line or after its last; anchoring the block's last line with `direction: "after"` (or its first line with `direction: "before"`) targets the gap right beside the block.
- `copy`/`move`: `source_from` and `source_to` may live in a different file than `anchor`; an empty destination file is seeded with the copied or moved lines.
- `move`: a batched cross-file move does not display the source file's diff; its removal commits with the batch, and the source file needs a read for fresh anchors.
```

## tool-prompts/grep.md

```
Search text files with ripgrep. Hits come back as `lineNumber:│ anchor│content` rows and context lines as `lineNumber-│ anchor│content`, editable with replace, insert, copy, or move without a new read. A row returned by `grep` is already a served row, so you do not need to `read` the file to edit that line. The `=== path ===` header and line numbers locate the match. Patterns use ripgrep's Rust regex syntax (no backreferences or look-around) through a linear-time engine. Searches respect `.gitignore`, always skip `.git`, and skip binary and image files silently. A match over 500 bytes is shown as a `...` fragment around the hit, but its anchor still covers the whole line. When output is cut by the match limit, raise `limit`; when cut by rows or bytes, refine `pattern` or narrow `path`.
```

## tool-prompts/grep-snippet.md

```
Search with `lineNumber:│ anchor│content` hits (`lineNumber-│` for context) usable directly for `replace`/`insert`; use `literal`/`glob`/`context`
```

## tool-prompts/grep-guidelines.md

```
- `grep`: set `literal: true` to match the text exactly, when characters such as `(`, `[`, `.`, or `*` in it must not act as regex.
```

## tool-prompts/undo-last-change.md

```
Undo the last replace, replace_match, insert, copy, or move on a file, restoring the previous content, BOM, and line endings. If the file changed since that edit, the undo is refused and the file is left untouched; a file deleted since the edit is restored.
```

## tool-prompts/undo-last-change-snippet.md

```
Revert a file's most recent edit (single level)
```

## tool-prompts/undo-last-change-guidelines.md

```
- `undo_last_change`: history is one slot per file, not a stack; a second undo returns `E_UNDO_NONE`.
- `undo_last_change`: a `write` clears the history, so undo before any other edit or write; the undo diff's `+anchor│` rows are the restored lines.
- `undo_last_change`: a cross-file `move` records one undo entry per file; undo both the source and the destination to revert the whole move, because undoing one side alone leaves the moved lines duplicated or missing.
```
