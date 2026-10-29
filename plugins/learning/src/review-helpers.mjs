export const QUIET = 15000,
	AGE = 30 * 60 * 1000;
export const REVIEW_PRESET = "hermes-learning-review";
export const reviewTools = (id = "learning") => [
	`${id}_review_memory_read`,
	`${id}_review_memory_edit`,
	`${id}_review_skill_store`,
];
export const REVIEW_TOOLS = reviewTools();
export const isUserInput = (e) =>
	e?.type === "message.in" &&
	e.from?.startsWith("acct:") &&
	!e.from.startsWith("acct:agent:") &&
	!e.conv?.startsWith("conv:agent:") &&
	e.data?.kind !== "agent";
export const keyOf = (events) =>
	events
		.map((e) => e.id)
		.sort()
		.join("\0");
export const mergeFocus = (a, b) => (!a ? b : !b ? a : a === b ? a : "combined");
export const includesFocus = (focus, target) => focus === "combined" || focus === target;
export const timeout = (promise, ms) =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		promise
			.catch(() => {})
			.finally(() => {
				clearTimeout(timer);
				resolve();
			});
	});

export async function transcript(api, id) {
	const items = [];
	let from = 0;
	for (;;) {
		const page = await api.sessions.transcript(id, { from, limit: 200 });
		items.push(...page);
		if (page.length < 200) break;
		from = page.at(-1).id + 1;
	}
	return items;
}
