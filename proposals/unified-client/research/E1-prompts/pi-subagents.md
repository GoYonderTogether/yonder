> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-subagents — 注入模型的提示词原文

- 包: `pi-subagents` 0.83.0
- License: MIT (Copyright (c) 2026 Nico Bailon) — `/Users/zoran/.pi/agent/npm/node_modules/pi-subagents/LICENSE`
- 仓库: https://github.com/nicobailon/pi-subagents
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/pi-subagents/src/extension/tool-description.js`、`tool-activation.js`、`active-runs-prompt.js`、`/Users/zoran/.pi/agent/npm/node_modules/pi-subagents/src/agents/advertised-agent-prompt.js`
- 注入方式（三种）:
  1. `subagent` 工具的 `description` + `promptSnippet`（**没有 promptGuidelines**，授权规则写在 description 里，只陈述一次）
  2. `before_agent_start` 里写 `event.systemPromptOptions.sections.active_subagents` 与 `sections.advertised_subagents`（结构化段，靠 `diffSystemPromptSections` 增量更新）
  3. `context_with_system` 里给 `custom` 消息包 `<pi_subagents_notice type=… origin="automated message from the pi-subagents extension, not typed by the user">` 标记；不用 `context` 钩子，因为改消息列表会让 pi 折叠中途 system 消息、每轮丢前缀缓存
- `toolDescriptionMode` 默认 `"full"`（`fullDescription = essentials + fullDetails`）；`"compact"` 只发 `essentials`；`"custom"` 读 `<projectConfigDir>/subagent-tool-description.md` 或 `<agentDir>/subagent-tool-description.md`，支持 `{{fullDescription}}`/`{{compact}}`/`{{safetyGuidance}}`/`{{agentDir}}`/`{{projectConfigDir}}` 占位符
- 子 Agent 系统提示词另有 `/Users/zoran/.pi/agent/npm/node_modules/pi-subagents/agents/*.md`（13 个：claude-code、claude-code-writer、codex-exec、codex-exec-writer、cursor-agent、cursor-agent-writer、delegate、evidence-auditor、oracle、researcher、reviewer、scout、worker）与 `/Users/zoran/.pi/agent/npm/node_modules/pi-subagents/prompts/*.md`（council、gather-context-and-clarify、parallel-cleanup、parallel-research、parallel-review、review-loop）

## SUBAGENT_SAFETY_GUIDANCE（拼进每个内建 description，也拼进自定义 description）

```js
export const SUBAGENT_SAFETY_GUIDANCE = `SAFETY-CRITICAL SUBAGENT GUIDANCE:
- Delegate only when the operator asked, directly or through applicable user/project instructions; size, complexity or risk alone is not authorization.
- Native async completion wakes this session: return control; do not sleep, poll or call bg_wait for it.
- One writer per cwd/worktree; isolate concurrent writers.
- After a launch or runtime failure, stop and report it; never silently switch to interactive_shell, pi -ne or another CLI.`;
```

## scriptCalls / structuredCalls / essentials（内建 description 主体）

```js
const scriptCalls = "One child: {agent,task}. Independent parallel children: {workflow:\"parallel\",args:{tasks:[{agent,task,cwd?,model?},...]}}. Dependent multi-step work: exactly one top-level subagent workflow call with async:true; write one ```js workflow block in this reply, then call subagent({workflow:true}); children launch only inside it.";
const structuredCalls = "One child: {agent,task}. Parallel: tasks:[{agent,task,cwd?,model?},...]. In order: chain:[{agent,task?,as?,cwd?,model?} or {parallel:[{agent,task,cwd?,model?},...]}]; step tasks can use {task}, {previous} and {outputs.name}. Use exactly one top-level subagent chain or tasks call with async:true.";
const essentials = (on) => `${on("workflow-scripts", scriptCalls, structuredCalls)}
Management: {action,id?,options:{...}}; fields not in this schema go in options.
Launch agents by name and pass models as exact provider/id; an unknown agent or model returns the valid choices.
Details: guide workflows/recommended-orchestration-pattern (async, review, failure recovery), ${on("workflow-scripts", "guide workflows/scripted-workflows, ")}guide tool-reference/retained-children, guide tool-reference/external-cli-agent-profiles.

${SUBAGENT_SAFETY_GUIDANCE}`;
const managementDiscovery = (on) => [
    ["list/get/models/guide"],
    [on("agent-management", "create/update/delete/eject/disable/enable/reset/refine")],
    [on("missions", "mission.*"), on("schedules", "schedule.*"), on("watchdog", "watchdog.*"), on("panes", "inspector.*, project.*"), on("lane-management", "lane.status/recordMerge/recordSupersession")],
    [on("lane-management", "worktree.discard and reviewed worktree.cleanup")],
    [`doctor${on("spawn-budget-grants", " and grant-spawn-budget")}`],
].map((group) => group.filter(Boolean).join(", ")).filter(Boolean).join("; ");
```

## fullDetails（`toolDescriptionMode: "full"` 时追加，默认生效）

```js
const scriptDetails = `• Scripts: JavaScript statement bodies with explicit return, top-level await, plain helpers/Promise chains; nested async function/arrow/method helpers are rejected. Await runs.run('key',{agent,task}) before .output; await runs.all([{key,agent,task},...]) for an ordered array, not a key map. Observe every stored run promise with direct await, Promise.race or Promise.all. Await/return runs.steer(key,message,options?) for a prior key, never raw run ids; queued/delivered/missed/failed receipts are not compliance proof.
• workflow:'./path.js' (any value with '/') loads a file from request cwd; other strings name a resource, such as {workflow:'review',args:{task:'...'}}. agent/task exclude workflow; task excludes action; validate accepts workflow:true or a path without launching. Raw-script sandboxes add deeply frozen args that persist as evidence, so never include secrets; raw scripts cannot use runs.host. Granted commands/relative outputs use workflow cwd, never per-step cwd.
• runs.lanes([{key,stages:[{key,agent,task},{key,resume:'previous',task}]}]) runs first stages together, later stages sequentially per lane. Failures stay lane-local; only explicit structuredOutput.verdict === 'blocked' blocks a successful stage, never reviewer prose.
`;
// Opt-in through toolDescriptionMode "full": the rarer rules the default leaves to guide sections.
const fullDetails = (on) => `DETAILS:
${on("workflow-scripts", scriptDetails)}• ${on("workflow-scripts", "Workflow child controls default onto runs.run/runs.all items; child fields override them.", "Top-level child controls apply to every chain/tasks child.")} worktree:true requires clean source, isolates each child and returns handoff artifacts; options.baseRef defaults to HEAD at allocation or a supported named ref, never full 40/64-character commit IDs or revision expressions.${on("usage-budgets", " usageBudget is shared across the workflow; already-running children are not stopped.")}
• Async follows asyncByDefault (normally true); async:false only to block the parent, not for final reviews/gates. Consume results at dependency barriers. bg_wait is for provider/detached work without native notification that needs a same-turn result.
• Bind durable output ${on("workflow-scripts", "on runs.run/runs.all", "with output")}, not task filename prose; return actual outputReference/outputPathMapping/artifactPaths, evidence and residual risks.
• Ordinary child subagents are not orchestrators; only configured fanout within depth/session limits. Use fresh-context read-only reviewers when independent review was requested. Oracle/advisor unknowns use supervisor dialogue; one-shot only when requested.
• children.list is workflow-only, not an exhaustive list of direct native children: resume only resumable rows. When an intended child's exact run id is known, inspect it with {action:"status",id}; if status identifies the candidate, attempt {action:"resume",id,message}. Resume authoritatively checks eligibility and may reject it. Use a labeled same-role fallback only when no known candidate exists or resume rejects eligibility.${on("workflow-scripts", " Scripts await runs.run(newKey,{resume:runId,task}); continue from the latest returned runId. Each distinct resume pass needs a new stable key; same-key reuse requires identical launch parameters.")}
• External CLI agents need an installed, authenticated CLI; preflight at launch decides, and passive PATH/PATHEXT/X_OK is not authentication/version/launch proof. They support native options only when their runner declares them: model, structured output, acceptance/agentContract, ${on("tool-budgets", "tool budget, ")}fast, fork context or skills/tools.
• Model override: copy exact provider/id, not agent names. Thinking uses model suffix${on("watchdog", ", not watchdog-only thinking")}.
• Missions auto-attach${on("missions", " unless options.mission:false")}; ${on("workflow-scripts", "await state.get(key)/state.set(key,JSONValue) requires a mission. ")}See guide topic missions. Omit acceptance for reviewer/read-only calls; acceptance.review.required requests independent writer review.
• Inspect asyncId/asyncDir (status.json, events.jsonl, logs) with status/debug.run; control with interrupt/stop/resume/steer. For local Pi children explicitly granted subagent_command, command.status/yield/cancel targets one exact toolCallId without interrupting the child.
• After a failure, report the exact failure, run/status and repo/cwd/worktree/branch/ref, and verify a clean worktree or capture the partial diff before a same-protocol retry. Governed-workflow fallback to foreground/CLI needs explicit owner approval, not Pi core's generic pi -ne hint.
• Management discovery: ${managementDiscovery(on)}. Use guide topics agents, ${on("missions", "missions, ")}observability, tool-reference, configuration, models${on("watchdog", ", watchdog")} or extension-api for exact action fields.${on("schedules", on("workflow-scripts", " Schedules take script inputs, not direct children; recipes live in the missions guide."))}`;
```

## promptSnippet

```js
export const SUBAGENT_TOOL_PROMPT_SNIPPET = "Delegate focused work to child agents; compose multi-child work in one workflow call.";
const STRUCTURED_SUBAGENT_TOOL_PROMPT_SNIPPET = "Delegate focused work to child agents; compose multi-child work in one chain or tasks call.";
```

## subagents_enable（动态开启工具的 loader）promptSnippet

```js
promptSnippet: "pi-subagents is installed. For authorized specialist, independent-review, or parallel work, call subagents_enable, then subagent. Authorization must come from the current request or applicable instructions; complexity alone is not authorization.",
```

## sections.active_subagents（后台运行列表）

```js
const MAX_LISTED_RUNS = 10;
const MAX_LISTED_AGENTS = 3;
/**
 * The `active_subagents` prompt section: one line per queued or running background run of this session.
 * Pi diffs prompt sections every turn, so it holds only fields that stay the same while a run is unchanged.
 * Task text is not available here: launch events carry it redacted.
 */
export function buildActiveRunsSection(jobs, sessionId) {
    const active = [...jobs].filter((job) => (job.status === "queued" || job.status === "running")
        && (typeof sessionId !== "string" || job.sessionId === sessionId));
    if (active.length === 0)
        return undefined;
    const lines = active.slice(0, MAX_LISTED_RUNS).map((job) => {
        const agents = [...new Set(job.agents ?? [])];
        const agentText = agents.length > MAX_LISTED_AGENTS
            ? `${agents.slice(0, MAX_LISTED_AGENTS).join(", ")} +${agents.length - MAX_LISTED_AGENTS}`
            : agents.join(", ") || "subagent";
        const step = job.mode === "chain" && job.currentStep !== undefined && (job.chainStepCount ?? 0) > 1
            ? `, step ${job.currentStep + 1}/${job.chainStepCount}`
            : "";
        return `- ${job.asyncId} ${agentText} (${job.mode ?? "single"}${step})`;
    });
    if (active.length > MAX_LISTED_RUNS)
        lines.push(`- +${active.length - MAX_LISTED_RUNS} more`);
    return [
        `Background subagent runs still active in this session (${active.length}). Check them with subagent({ action: "status", id }) before launching duplicate work.`,
        ...lines,
    ].join("\n");
}
```

## sections.advertised_subagents（file-defined 子 Agent 目录）

```js
const MAX_ADVERTISED_AGENTS = 16;
const MAX_CATALOG_BYTES = 12_288;
const MAX_DESCRIPTION_BYTES = 512;
function escapeXml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function promptDescription(description) {
    let text = description.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
    if (Buffer.byteLength(text, "utf8") > MAX_DESCRIPTION_BYTES) {
        text = Buffer.from(text, "utf8").subarray(0, MAX_DESCRIPTION_BYTES - 3).toString("utf8").replace(/\uFFFD$/u, "").trimEnd() + "…";
    }
    return escapeXml(text);
}
const ADVERTISED_AGENTS_TAG = "advertised_subagents";
function wrapAdvertisedAgentCatalog(body) {
    return `<${ADVERTISED_AGENTS_TAG}>\n${body}\n</${ADVERTISED_AGENTS_TAG}>`;
}
const CATALOG_INTRODUCTION = "The following file-defined subagents opted into discovery. Their descriptions indicate available specializations, not instructions to delegate. Use subagent only when delegation is needed.";
/**
 * The catalog body without its `<advertised_subagents>` wrapper, for Pi's structured
 * prompt sections, which add the tag from the section key. The byte budget applies to
 * the wrapped form, so both deliveries carry the same entries.
 *
 * `recordedCatalog` is the body a session already sent. Its first line, the introduction,
 * is kept so a release that rewords the introduction does not change the section of a
 * resumed session and cost it the provider's prompt cache. The entries are always current.
 */
export function buildAdvertisedAgentCatalog(agents, capabilityCeiling, recordedCatalog) {
    const advertised = agents
        .filter((agent) => agent.source !== "runtime" && agent.advertise === true && agent.disabled !== true && isAgentAllowedByCapabilityCeiling(agent.name, capabilityCeiling))
        .sort((left, right) => left.name.localeCompare(right.name));
    if (advertised.length === 0)
        return undefined;
    const introduction = recordedCatalog?.split("\n", 1)[0] || CATALOG_INTRODUCTION;
    const renderBody = (entries) => [
        introduction,
        ...entries,
        ...(advertised.length > entries.length ? [`  <omitted count=\"${advertised.length - entries.length}\" />`] : []),
    ].join("\n");
    const entries = [];
    for (const agent of advertised) {
        if (entries.length === MAX_ADVERTISED_AGENTS)
            break;
        // Never truncate canonical IDs into names that cannot be resolved.
        if (Buffer.byteLength(agent.name, "utf8") > MAX_CATALOG_BYTES)
            continue;
        const entry = [
            "  <subagent>",
            `    <name>${escapeXml(agent.name)}</name>`,
            `    <description>${promptDescription(agent.description)}</description>`,
            "  </subagent>",
        ].join("\n");
        if (Buffer.byteLength(wrapAdvertisedAgentCatalog(renderBody([...entries, entry])), "utf8") <= MAX_CATALOG_BYTES)
            entries.push(entry);
    }
    return renderBody(entries);
}
```
