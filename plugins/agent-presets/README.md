# agent-presets

Official prompts use the existing SDK contexts and presets slots. There is one runtime and no new Agent hierarchy.

| Preset | Purpose | Contexts |
|---|---|---|
| jarvis | Resident personal assistant | jarvis-soul, jarvis-work |
| default-agent | Resident collaborator with a configured remit | default-agent-soul, default-agent-work |
| default | Bounded general work | task-general |
| coding | Implement and verify software changes | task-general, task-coding |
| research | Read sources, compare evidence and cite findings | task-general, task-research |

Resident contexts scaffold missing SOUL.md and AGENTS.md from prompts/<preset>/ and then read the actual workspace files. Existing edits and intentionally empty files survive. An identity-less task selecting a resident preset receives no resident persona. New init selects Jarvis; agents create --preset default-agent uses the real name, work, owner and explicit bindings supplied by the owner.

Task contexts are static Markdown under prompts/tasks/, with no access to a resident workspace. task_run and independently opened sessions select the same presets. Keep a work session open for follow-up inputs; create a resident only for continuing ownership and identity. A resident may deliberately select a task context alongside its own soul/work contexts without acquiring another identity.

Default and coding offer read, grep, write, edit, bash, process and skill_view with read/write/exec/network capabilities. Research offers read, grep, skill_view and the three web-tools tools, with read/network only. No task preset offers message delivery, administration or recursive delegation. Child capabilities remain intersected with the caller. Shell execution is not a sandbox.

The plugin's research preset selects only agent-presets so older homes without web-tools remain valid. New init loads web-tools and writes a research override selecting both plugins. For an existing home, load web-tools through plugin management and update research with `{"plugins":["agent-presets","web-tools"]}` using presets update --file. Fetching a public URL does not require a search key; search/extract require the actual configured Tavily credential. This plugin starts no service and injects no credentials.

Home presets/<id>.yaml override plugin presets with the same id. Template updates do not rewrite personal files or existing home presets. Use prompt.sections/overrides for built-in text; contexts selects task and persona blocks, with [] disabling them; instructions supplies replacement or additional text. For a shortened task prompt, deselect its context and supply the reviewed shorter instructions. See docs/prompts/configuration.md.

Detailed originals, pinned sources, licenses and adaptation notes are in [prompts/SOURCES.md](prompts/SOURCES.md). Archived upstream documents are provenance, not automatically injected instructions. System-wide communication remains in core; plugin-specific usage and troubleshooting stay with their tools and skills. Full mapping: docs/prompts/README.md.
