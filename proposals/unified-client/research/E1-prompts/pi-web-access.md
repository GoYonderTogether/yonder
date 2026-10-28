> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-web-access — 注入模型的提示词原文

- 包: `pi-web-access` 0.45.0
- License: MIT (Copyright (c) 2025 Nico Bailon) — `/Users/zoran/.pi/agent/npm/node_modules/pi-web-access/LICENSE`
- 仓库: https://github.com/nicobailon/pi-web-access
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/pi-web-access/dist/index.js` 中 5 处 `pi.registerTool({...})`（name/label/description/promptSnippet），以及 `tool-activation.ts` 的 `web_enable` loader
- 注入方式: 工具默认**不激活**，由 `web_enable` 动态开启（`pi.setActiveTools`）；`web_enable` 的 promptSnippet 与各工具 promptSnippet 进 rules 段

## registerTool 定义（按源码顺序）

```js
pi.registerTool({
    name: LOADER_NAME,
    label: "Enable Web Access",
    description: "Enable configured pi-web-access tools for web research and content retrieval. Does not search or fetch. Enabled tools are available on the next model request; disabled capabilities remain unavailable.",
    promptSnippet: `If tools for ${capabilities} are not already available, call web_enable first whenever current, external, or linked information could help; the tools appear on the next model request.`,
```

```js
pi.registerTool({
    name: toolNames.webSearch,
    label: "Web Search",
    prepareArguments: (args) => parseStringifiedArrays(args, ["queries", "domainFilter"]),
    description: `Search the web for sources or answers.${getSearchContentEnabled ? ` Full results are stored for retrieval with ${toolNames.getSearchContent} by responseId.` : ""} Prefer 2-4 varied queries.`,
    promptSnippet: "Web research. Prefer {queries:[...]} with 2-4 varied angles; omit provider unless overriding the default.",
```

```js
pi.registerTool({
    name: toolNames.sourceCheck,
    label: "Source Check",
    description: "Gather cited web passages about a claim for manual review.",
    promptSnippet: "Gather source evidence with passage citations for a claim.",
```

```js
pi.registerTool({
    name: toolNames.fetchContent,
    label: "Fetch Content",
    description: `Fetch web pages, PDFs, GitHub repos, images, YouTube and local video, as the mode allows. ${fetchContentStorageNote}`,
    promptSnippet: `Use to fetch URL content, direct images, GitHub repos, and videos.${fetchModeConfig.allowedModes.includes("extract") ? ' For specific values (a price, version, date or limit), use mode "extract" with fields instead of reading the whole page.' : ""}`,
```

```js
pi.registerTool({
      name: toolNames.getSearchContent,
      label: "Get Search Content",
      description: `Page through or search stored content from ${storedContentSources} by responseId.`,
      promptSnippet: `Use after ${storedContentSources} to read stored content; findText finds passages without paging.`,
```