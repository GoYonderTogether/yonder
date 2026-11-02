/** Add the self-only main route only when an official QQ group proves this Agent needs one. */
export function parentMigration(
	agent: string,
	groups: Map<string, string>,
	bindings: Array<Record<string, unknown>>,
	fallback: string,
) {
	if (!groups.size) return;
	const includes = (value: unknown, target: string) =>
		value === undefined || (Array.isArray(value) ? value.includes(target) : value === target);
	if (
		bindings.some(({ match }) => {
			const route = match as Record<string, unknown> | undefined;
			return (
				includes(route?.channel, "agent") &&
				includes(route?.kind, "parent-request") &&
				includes(route?.type, "message.in")
			);
		})
	)
		return;
	const instance = groups.keys().next().value as string;
	const id = `${instance}-parent`;
	const main = bindings.find((binding) => binding.session === "main" && binding.wake !== "write");
	if (bindings.some((binding) => binding.id === id)) return { instance, reason: `id ${id} is already used` };
	if (!main) return { instance, reason: "no usable main binding exists" };
	return {
		instance,
		binding: {
			id,
			match: { channel: "agent", kind: "parent-request", from: `acct:agent:${agent}` },
			session: "main",
			profile: (main.profile as string | undefined) ?? fallback,
			reply: "none",
			busy: "followup",
		},
	};
}
