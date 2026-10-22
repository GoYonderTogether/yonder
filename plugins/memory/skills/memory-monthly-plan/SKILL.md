---
name: memory-monthly-plan
description: Use for the monthly ritual. Looks back over the month, records phase changes, and proposes next month's goals.
---

# Monthly plan

Run unattended. Propose only.

## Steps

1. Read the month document and its weekly documents (`memory_read`, `memory_plan` `get` with scope month). Do not rely on memory of earlier runs.
2. `memory_review` `section` (month, `月复盘`, mode `replace`): what the month was about, goals met or not, patterns across weeks. Facts only.
3. Phase changes: where an `me/` entry was closed or superseded this month, write one line each under `阶段变化` (mode `append`) with the date.
4. Read `life/` (vision and year). Check that next month's proposals actually serve them; say so when they do not.
5. `memory_plan` `propose` (month, next period): three to five goals at most, each tied to the year goal it serves.

## Message

Short. The month in two sentences, any phase change worth knowing, and the proposed goals. Ask which to confirm.
