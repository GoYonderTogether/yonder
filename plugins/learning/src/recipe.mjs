// Installation recipe asset; neither a Yonder task preset nor upstream Hermes preset.
export const recipeId = "hermes-resident-v1";
export const systemIdentity =
	"# Hermes\n\nIndependent Yonder resident Agent id hermes. Optional experience is supplied by the selected learning plugin. No upstream Hermes runtime is implied.\n";
export function runtimeProfile(enabled = true, learning = true, id = "learning") {
	return {
		model: "openai/gpt-6.1-sol",
		thinking: "medium",
		env: "local",
		instructions: "",
		capabilities: ["read", "write"],
		plugins: enabled ? [id] : [],
		contexts: enabled ? ["hermes-behavior", "hermes-memory", "hermes-core"] : [],
		skills: enabled ? (learning ? ["hermes-yonder", "skill-creator", "hermes-learned-*"] : ["hermes-yonder"]) : [],
		tools: {
			offer: enabled
				? [
						"read",
						"skill_view",
						`${id}_memory_read`,
						`${id}_memory_edit`,
						`${id}_memory_pending`,
						`${id}_refine`,
						...(learning ? [`${id}_skill_store`] : []),
					]
				: ["read"],
			search: [],
		},
	};
}
export function registration(owner, learning = true, id = "learning") {
	return {
		name: "Hermes",
		work: "Independent Hermes-derived Yonder assistant; bounded curated memory and teaching assets.",
		owner,
		bindings: [
			{
				id: "hermes-agent",
				match: { channel: "agent", kind: "agent", from: "acct:agent:main" },
				session: "ephemeral",
				profile: "default",
				reply: "none",
			},
		],
		profile: runtimeProfile(true, learning, id),
	};
}
