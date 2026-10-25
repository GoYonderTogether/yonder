// Installation recipe asset; neither a Yonder task preset nor upstream Hermes preset.
export const recipeId = "hermes-resident-v1";
export const systemIdentity =
	"# Hermes\n\nIndependent Yonder resident Agent id hermes. Optional experience is supplied by the selected hermes-experience plugin. No upstream Hermes runtime is implied.\n";
export function runtimeProfile(enabled = true, learning = true) {
	return {
		model: "openai/gpt-6.1-sol",
		thinking: "medium",
		env: "local",
		instructions: "",
		capabilities: ["read", "write"],
		plugins: enabled ? ["hermes-experience"] : [],
		contexts: enabled ? ["hermes-behavior", "hermes-memory", "hermes-core"] : [],
		skills: enabled ? (learning ? ["hermes-yonder", "skill-creator", "hermes-learned-*"] : ["hermes-yonder"]) : [],
		tools: {
			offer: enabled
				? [
						"read",
						"skill_view",
						"hermes-experience_memory_read",
						"hermes-experience_memory_edit",
						"hermes-experience_memory_pending",
						"hermes-experience_refine",
						...(learning ? ["hermes-experience_skill_store"] : []),
					]
				: ["read"],
			search: [],
		},
	};
}
export function registration(owner, learning = true) {
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
		profile: runtimeProfile(true, learning),
	};
}
