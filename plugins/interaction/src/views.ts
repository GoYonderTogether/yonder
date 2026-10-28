import type { PluginAPI, ViewContent } from "@yonder/sdk";
import type { CompanionService } from "./service.js";

const id = "interaction.card";

export function registerViews(api: PluginAPI, service: CompanionService): void {
	service.onViewChanged(() => api.invalidate([id]));
	api.views.register(
		{
			id,
			plugin: "interaction",
			title: "Interaction",
			placement: "floating",
			scope: "session",
			actions: ["answer"],
			actScope: "owner",
		},
		{
			data(session) {
				const { revision, interaction } = service.view(session);
				const card = interaction?.card;
				const content: ViewContent = !card
					? { type: "list", items: [] }
					: card.kind === "choice"
						? { type: "choice", prompt: card.prompt, options: card.options ?? [] }
						: { type: "input", prompt: card.prompt };
				return { viewId: id, rev: revision, content };
			},
			async act(_action, input, session) {
				const { interaction, revision } = service.view(session);
				const answer = input as { rev?: unknown; answer?: unknown } | null;
				if (!interaction || answer?.rev !== revision || typeof answer.answer !== "string")
					throw Object.assign(new Error("Invalid interaction answer"), { code: "invalid_params" });
				await service.answer(interaction.id, answer.answer, interaction.steps.length);
				return {};
			},
		},
	);
}
