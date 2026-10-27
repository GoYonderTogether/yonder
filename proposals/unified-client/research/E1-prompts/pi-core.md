# pi-core — pi 本体拼装系统提示词的原文

- 包: `@earendil-works/pi-coding-agent` 1.4.0
- License: 见 `/Users/zoran/.local/share/mise/installs/node/24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/LICENSE`（pi 自身许可，未在本次调研中复制正文）
- 仓库: https://github.com/earendil-works/pi
- 来源: `/Users/zoran/.local/share/mise/installs/node/24.21.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js`、`dist/core/skills.js`、`dist/core/resource-loader.js`、`dist/core/compaction/compaction.js`、`dist/core/settings-defaults.js`
- 说明: pi 的系统提示词不是一整段常量，而是 `buildSystemPromptSections()` 组装的分段结构。除 preamble 外，每段都包在 `<段名>\n…\n</段名>` 里，段名依次为 `tools`、`rules`、`docs`、`addendum`、`project_context`、`skills`、`cwd`，扩展可用 `event.systemPromptOptions.sections.<key>` 追加自定义段（`diffSystemPromptSections` 只把变化段以增量补丁发出，`null` 表示删除该段——这是保住前缀缓存的关键）。

## 1. preamble（无包裹标签）

```text
(not found: const PREAMBLE)
```

## 2. buildSystemPromptSections（段顺序与包裹方式）

```js
export function buildSystemPromptSections(input) {
    const options = normalizeBuildSystemPromptOptions(input);
    const { customPrompt, selectedTools, hiddenTools, toolSnippets, toolGuidelines, promptGuidelines, appendSystemPrompt, sections: customSections, cwd, contextFiles, skills, } = options;
    for (const name of Object.keys(customSections)) {
        if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
            throw new Error(`Invalid system prompt section name: ${name}`);
        }
    }
    const declaredTools = selectedTools.filter((name) => !hiddenTools.includes(name));
    const promptSections = {};
    if (customPrompt) {
        promptSections.preamble = customPrompt;
    }
    else {
        promptSections.preamble =
            "You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
        const visibleTools = declaredTools.filter((name) => !!toolSnippets[name]);
        const tools = visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n") : "(none)";
        promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
        promptSections.rules = buildRules(declaredTools, toolGuidelines, promptGuidelines);
        promptSections.docs = `Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${getReadmePath()}
- Additional docs: ${getDocsPath()}
- Examples: ${getExamplesPath()} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
    }
    if (appendSystemPrompt)
        promptSections.addendum = appendSystemPrompt;
    if (contextFiles.length > 0)
        promptSections.project_context = renderProjectContext(contextFiles);
    // A hidden reader is still reachable through another tool, so skills stay but the hint names no tool.
    const readers = ["read", "bash"];
    const skillFileReadTool = readers.find((tool) => declaredTools.includes(tool)) ??
        (readers.some((tool) => selectedTools.includes(tool)) ? "indirect" : undefined);
    if (skillFileReadTool && skills.length > 0) {
        const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
        if (skillsPrompt)
            promptSections.skills = skillsPrompt;
    }
    promptSections.cwd = cwd.replace(/\\/g, "/");
    for (const [name, content] of Object.entries(customSections)) {
        if (content)
            promptSections[name] = content;
    }
    const sections = { preamble: promptSections.preamble };
    for (const [name, content] of Object.entries(promptSections)) {
        if (name !== "preamble")
            sections[name] = `<${name}>\n${content}\n</${name}>`;
    }
    return sections;
}
/**
 * The complete prompt state for `input`. A forced prompt is opaque and lives in `content`
 * with no sections; otherwise `content` is empty and the structured sections carry the prompt.
 */
export function buildSystemPromptState(input) {
    if (input.forceSystemPrompt !== undefined)
        return { content: input.forceSystemPrompt };
    return { content: "", sections: buildSystemPromptSections(input) };
}
/** Bu
```

## 3. buildRules（rules 段生成规则）

```js
(not found: export function buildRules)
```

## 4. renderProjectContext（project_context 段）

```js
function renderProjectContext(contextFiles) {
    return [
        "Project-specific instructions and guidelines:",
        ...contextFiles.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`),
    ].join("\n\n");
}
function buildRules(selectedTools, toolGuidelines, promptGuidelines) {
    const rules = [];
    const seen = new Set();
    const addRule = (rule) => {
        const normalized = rule.trim();
        if (!normalized || seen.has(normalized))
            return;
        seen.add(normalized);
        rules.push(normalized);
    };
    const hasBash = selectedTools.includes("bash");
    const hasPowerShell = selectedTools.includes("powershell");
    const hasGrep = selectedTools.includes("grep");
    const hasFind = selectedTools.includes("find");
    const hasLs = selectedTools.includes("ls");
    if ((hasBash || hasPowerShell
```

## 5. formatSkillsForPrompt（skills 段）

```js
export function formatSkillsForPrompt(skills, fileReadTool = "read") {
    const visibleSkills = skills.filter((s) => !s.disableModelInvocation);
    if (visibleSkills.length === 0) {
        return "";
    }
    const lines = [
        "\n\nThe following skills provide specialized instructions for specific tasks.",
        fileReadTool === "read"
            ? "Use the read tool to load a skill's file when the task matches its description."
            : fileReadTool === "bash"
                ? "Use bash to load a skill's file when the task matches its description."
                : "Load a skill's file when the task matches its description.",
        "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
        "",
        "<available_skills>",
    ];
    for (const skill of visibleSkills) {
        lines.push("  <skill>");
        lines.push(`    <name>${escapeXml(skill.name)}</name>`);
        lines.push(`    <description>${escapeXml(skill.description)}</description>`);
        lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
        lines.push("  </skill>");
    }
    lines.push("</available_skills>");
    return lines.join("\n");
}
function escapeXml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
/**
 * Load skills from all configured locations.
 * Returns skills and any validation diagnosti
```

## 6. AGENTS.md 发现顺序（resource-loader.js）

```text
候选文件名（同目录取第一个命中）: AGENTS.override.md > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD
加载顺序: <agentDir>/AGENTS.md 先入列，然后从 cwd 逐级向上到根，用 unshift 前插 => 祖先目录在前、cwd 最后
嵌套 linked worktree 会通过 findShadowedContextFile() 去重，避免同一逻辑仓库上下文重复注入
```

## 7. 自带 compaction 的摘要提示词（SUMMARIZATION_PROMPT）

```js
(not found: export const SUMMARIZATION_PROMPT)
```

## 8. 增量更新摘要（已有摘要时）

```js
const UPDATE_SUMMARIZATION_INSTRUCTIONS = `Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;
const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

${UPDATE_SUMMARIZATION_INSTRUCTIONS}`;
/**
 * Returns an error message when a summarization response cannot safely be persisted.
 * A length stop contains partial text and must not become a session checkpoint.
 */
export function getSummarizationFailure(response, label) {
    if (response.stopReason === "error") {
        return `${label} failed: ${response.errorMessage || "Unknown error"}`;
    }
    if (response.stopReason === "length") {
        return `${label} failed: generation hit the token cap and the summary is incomplete`;
    }
    return undefined;
}
function createSummarizationOptions(model, apiKey, headers, env, signal, thinkingLevel, sessionId) {
    const options = { signal, apiKey, headers, env, sessionId };
    if (model.reasoning && thinkingLevel && thinkingLevel !== "off") {
        options.reasoning = thinkingLevel;
    }
    r
```
