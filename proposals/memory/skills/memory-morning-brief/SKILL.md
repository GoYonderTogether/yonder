---
name: memory-morning-brief
description: Use for the morning ritual. Sends one brief message with today's priorities from the plan and anything due.
---

# Morning brief

Run unattended.

## Steps

1. `memory_plan` `get` (week). Take open items, those with a due date today or earlier first.
2. Check decisions whose review date is today or earlier (`memory_read` the week's `决定` section) and any proposals waiting for the owner.
3. If there is nothing to say, reply NO_REPLY. An empty brief is noise.

## Message

At most five lines, owner's language: the one to three things that matter today, anything overdue, anything waiting for their answer. No greeting, no motivation.
