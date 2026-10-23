# agent-presets

Official starting prompts for two resident Agents: `jarvis` (the main personal assistant) and `default-agent` (a continuing collaborator with a configured remit).

Uses only the existing SDK contexts and presets slots. Each preset selects its own `*-soul` and `*-work` contexts. Missing `SOUL.md` and `AGENTS.md` are scaffolded from `prompts/<preset>/`; rendering reads the actual workspace files. Existing files, edits and intentionally empty files are preserved. Select one context per file, not both a role context and the generic context-files reader.

New `yonder init` selects Jarvis. To create another resident, use `yonder agents create <id> --preset default-agent --file <configuration.json>` with the real name, work, owner and explicit bindings required by that command. Check `--help` for the installed version. The templates add no capabilities; specify the intended profile explicitly. An identity-less task using either preset receives no resident persona.

For an existing home, install/load this plugin through the existing plugin management flow, then explicitly select its contexts. This does not replace old SOUL/AGENTS files. Template updates apply to newly scaffolded files; review and edit existing files intentionally. The official prompts are defaults, not a migration or enforced persona.

System-wide execution and communication guidance stays in core. Plugin-specific instructions and recovery stay with the relevant tools/skills/contexts; this plugin starts no services, creates no schedule and grants no cloud computer. Sources and the full section mapping are in `docs/prompts/README.md`; Jarvis provenance is retained beside its prompt files.
