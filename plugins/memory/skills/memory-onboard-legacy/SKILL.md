---
name: memory-onboard-legacy
description: Use to converge an old notes folder (a registered `legacy` source such as an old Obsidian vault) into the memory. Reads each note, files what is useful as proposals, never edits the old folder.
---

# Converge a legacy source

Registered sources with origin `legacy` are read-only and their authorship is unconfirmed. Treat their content as hypotheses, not facts about the owner.

## Steps

1. List the source with `memory_search` (zone = the source name) and read notes one at a time with `memory_read`. Work in small batches; stop and report if the owner interrupts.
2. For each note decide, in order of usefulness:
   - a durable fact or preference about the owner: `memory_me` `add` with `status: "inferred"` and the note path as the reason in the text. Never `confirmed`.
   - a project: write or extend a file under `projects/` through `memory_capture` (`kind: "material"`) with a short summary and a pointer to the original.
   - an action that is still plausible: `memory_plan` `propose` into the current week or month.
   - stale, duplicated or personal-secret content: skip it. Do not copy credentials or secrets anywhere.
3. Keep a short running list of `path → where it went` and include it in your report, so the owner can decide whether to archive the old folder.
4. Dates inside old notes are not today's dates. Do not turn an old to-do into a due task without saying it is old.

## Report

Counts first (notes read, facts proposed, projects touched, items skipped), then the three or four most important findings. Ask whether the old folder can now be archived; do not archive it yourself.
