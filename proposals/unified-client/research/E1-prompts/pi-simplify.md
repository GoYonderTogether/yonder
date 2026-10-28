> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-simplify — 注入模型的提示词原文

- 包: `pi-simplify` 0.2.3
- License: MIT（`package.json` 声明；**包内无 LICENSE 文件**）— `/Users/zoran/.pi/agent/npm/node_modules/pi-simplify/package.json`
- 仓库: https://github.com/MattDevy/pi-extensions (packages/pi-simplify)
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/pi-simplify/dist/prompt-builder.js` 的 `buildSimplifyPrompt(files)`
- 注入方式: **不注册工具**，只注册 `/simplify` 命令；命令把整段文本作为 user message 用 `pi.sendUserMessage(prompt, { deliverAs: "followUp" })` 发给模型

## buildSimplifyPrompt（`${fileList}` 处为变更文件清单）

```text
export function buildSimplifyPrompt(files) {
    const fileList = files.map(formatFile).join("\n");
    return `Review the following recently changed files and apply simplification improvements.

## Principles

- **Preserve functionality**: Never change what the code does. All existing tests must continue to pass.
- **Apply project standards**: Follow any conventions from CLAUDE.md or AGENTS.md in this project.
- **Enhance clarity**: Reduce unnecessary complexity and nesting, eliminate redundant code and abstractions, improve variable and function names, and consolidate related logic. Keep valuable comments that explain design rationale, business rules, non-obvious behaviour, or intent. Remove only truly redundant noise, such as \`// increment i\` above \`i++\`. Avoid nested ternary operators: prefer switch statements or if/else chains for multiple conditions.
- **Maintain balance**: Do not over-simplify. Avoid overly clever solutions that are hard to understand. Do not combine too many concerns into single functions. Do not remove helpful abstractions. Prioritize readability over fewer lines.

## Scope

Only review and modify the changed lines listed below. Changed line numbers refer to
the current file contents. You may read surrounding code for context, but must not
edit it. For added files, the entire file is considered changed.
${fileList}

## Process

1. Read each file listed above and inspect its changed lines
2. Identify concrete improvements within those lines (dead code, unclear names, redundant logic, inconsistent patterns)
3. Apply changes one file at a time, keeping every edit within the listed line ranges
4. After all changes, run existing tests to verify nothing is broken
5. Summarize what you changed and why

Do NOT add new features, change public APIs, or refactor code outside the listed
line ranges. If a worthwhile simplification would require editing unchanged code,
leave it alone and mention it in the summary instead.`;
}
//# sourceMappingURL=prompt-builder.js.map
```
