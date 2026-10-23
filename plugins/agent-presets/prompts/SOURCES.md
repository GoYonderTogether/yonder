# Task prompt sources and adaptations

The owner requested detailed source text and examples, not a short summary. The actual model-visible files are tasks/general.md, tasks/coding.md and tasks/research.md. The upstream/ directory preserves the inspected originals and licenses; it is not loaded into model context. Shared communication/style examples remain in core's common prompt, and resident identities remain in jarvis/ and default-agent/.

## OpenCode — main coding reference

- Repository: [anomalyco/opencode](https://github.com/anomalyco/opencode), pinned commit `4d30794bcf4dccdcadbcb1f62bb35b4943a96426`, inspected 2026-10-23.
- [GPT instructions](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/plugin/system-prompt/gpt.txt) → upstream/opencode-gpt.txt. Reused substantial wording on work continuation, concise informative updates, final outcomes, independent reads, existing changes, destructive commands and non-interactive Git in general/coding. These are task methods, not an imported OpenCode runtime.
- [Agent definitions / PROMPT_EXPLORE](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/plugin/agent.ts) → upstream/opencode-explore.txt (the exact extracted prompt string). Adapted search depth, concrete paths and read-only investigation to Yonder. OpenCode's agent modes, tool names and system-reminder authority are not imported.
- [Anthropic comments instruction](https://github.com/anomalyco/opencode/blob/4d30794bcf4dccdcadbcb1f62bb35b4943a96426/packages/core/src/plugin/system-prompt/anthropic.txt) → upstream/opencode-comments.txt. The comment-density paragraph is reproduced in coding.
- MIT; full copyright and license in upstream/LICENSE.opencode.

## CopilotKit OpenMuse — research reference

- Repository: [CopilotKit/openmuse](https://github.com/CopilotKit/openmuse), pinned commit `1ac68f3909f2478ab6280883f1ab5ea65eb5719d`, inspected 2026-10-23.
- [Worker model](https://github.com/CopilotKit/openmuse/blob/1ac68f3909f2478ab6280883f1ab5ea65eb5719d/apps/server/src/engine/model.ts) → upstream/openmuse-worker.txt (the original prompt expression, including its unevaluated template variables). Adapted concrete planning, source reading, non-fabrication, missing integrations and external-action boundaries.
- [Search instructions](https://github.com/CopilotKit/openmuse/blob/1ac68f3909f2478ab6280883f1ab5ea65eb5719d/apps/server/src/search.ts) → upstream/openmuse-search.txt (the original searchDescription/searchInstructions exports). Reused and expanded the self-contained query, excerpts, URL citations, untrusted search results, empty/error/truncation guidance in research.
- Removed prepare_email/prepare_calendar_event, finish_task, the OpenMuse approval tool and any promise of its connectors. Yonder uses the configured web-tools, real credentials and normal final response. Research explicitly states when only excerpts or public URL extraction are available.
- MIT; full copyright and license in upstream/LICENSE.openmuse.

## Ponytail — engineering method

- Repository: [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail); installed plugin distribution **4.10.0**, metadata author Dietrich Gebert, inspected 2026-10-23. The exact locally installed SKILL.md is preserved as upstream/ponytail.md; no unverified upstream commit is claimed.
- Coding reproduces the ladder, root-cause explanation, concrete engineering tradeoffs and most of the full rules and “When NOT to be lazy” text. The efficiency principle cannot remove requested work or required validation.
- Deliberate adaptations: removed mode persistence, activation commands, invented senior-developer biography and three-line output cap; replaced “ship a partial lazy version” with completing the explicit outcome; retained existing project checks rather than forbidding their framework. Detailed reports remain available when requested.
- MIT; original copyright and license in upstream/LICENSE.ponytail.

## Other references and boundaries

- Yonder's installed development/self-management skills supply its real SDK, home/checkout/installed-version separation, documentation and isolated-acceptance workflow. They are already part of this repository and are selected through the normal skill index; no extra global skill dump is introduced.
- [vedaant00/opendot](https://github.com/vedaant00/opendot) was compared as a local assistant reference. Its fixed connector protocol and promise that every action is undoable do not describe Yonder, so its prompt is not copied into an active preset. The distinct defog-ai/opendot wraps external coding runtimes and is not adopted as another Yonder engine.
- [diggerhq/openmuse](https://github.com/diggerhq/openmuse) is a different project from CopilotKit/openmuse. No license was found during inspection; its architecture was compared, but its prompt text is not redistributed.
- No text from private Codex instructions or unlicensed installed skills is copied. Owner-supplied material and the existing prompt-layer mapping are documented in docs/prompts/README.md. All copied task-source text above retains its license beside the packaged source.

A preset selects instructions, model and tools; it does not create a resident identity, transfer every parent message, grant a cloud computer, establish a sandbox or reproduce the source product's success rate. Tool restrictions come from Yonder's existing capabilities and offer/search selection. Templates remain editable and removable by configuration.
