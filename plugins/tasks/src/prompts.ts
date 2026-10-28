// Model-facing text for the tasks plugin. Written by the maintainer's lead; keep wording as is.

export const OPEN = `Record a task line you have accepted: who asked, the objective, 2-5 acceptance points that each name a concrete piece of evidence (command output, file, PR state), and what is out of scope. Do this when you take the task on, before the work; small things you simply do need no record. A new request that belongs to an existing task is merged into it with tasks_update, rewriting its objective and acceptance, not stacked beside it.`;

export const UPDATE = `Change a task's state or content: active, waiting-user, blocked, review, or a revised objective/acceptance. Use waiting-user only when you need one specific thing from the person; name it. Use blocked when a specific fact or capability stops the next step; name it. Add what you learned or delivered so far.`;

export const DONE = `Close a task. Before calling it, go through each acceptance point and attach the real evidence for it: the command and its result, the file, the PR. Passing checks that do not cover an acceptance point do not count. If it is only partly met, say which points are met, which are not, and open a follow-up task for the rest instead of continuing here. Write the deliverable the way you would tell the person what they now have.`;

export const LIST = `List tasks you can see: yours by default, and those of your sub-agents. A steward profile also sees other agents' in-progress tasks. Use it to answer "what are you working on" and to plan next steps.`;

export const GET = `Read one task with its full history and deliverable.`;

export const SHOW = `Show the task board in the current channel as an image or return it as JSON. Use it when the person asks what is going on or when several tasks are in flight.`;

export const NUDGE = `Steward only. Send an agent a reminder about one of its tasks that has gone quiet. State what you see and what you need back: continue, blocked, or waiting-user. It reaches the agent through its own session and binding.`;

export const TURN_ONE_LINE = (title: string, state: string, elapsed: string, wakeups: number, sinceDelivery: string) =>
  `Task "${title}": ${state}, ${elapsed} in, ${wakeups} wake-ups, ${sinceDelivery} since the last delivery.`;

export const STALL_NOTICE = (title: string, state: string, minutes: number) =>
  `Task "${title}" has had no progress for ${minutes} minutes (state: ${state}). If work remains, continue it; if a specific fact or capability stops you, mark it blocked and name it; if you need the person, mark it waiting-user and name the one thing. If it is finished, close it with the evidence.`;

export const NUDGE_INPUT = (title: string, from: string, say: string) =>
  `Reminder from ${from} about task "${title}": ${say} Reply by continuing the work, or mark it blocked or waiting-user and name the one thing that stops it.`;

export const USER_WAIT_NOTICE = (zh: boolean, title: string, minutes: number, waitingFor: string) => {
  const hours = Math.round(minutes / 60);
  const duration = minutes >= 60 ? (zh ? `约 ${hours} 小时` : `about ${hours} ${hours === 1 ? "hour" : "hours"}`) : (zh ? `${minutes} 分钟` : `${minutes} minutes`);
  return zh ? `任务「${title}」已等你 ${duration}：${waitingFor}` : `Task "${title}" has been waiting on you for ${duration}: ${waitingFor}`;
};
