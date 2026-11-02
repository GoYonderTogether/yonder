export function runtimeNote(requestId: string, text: string) {
	return {
		type: "write" as const,
		requestId,
		entry: {
			kind: "yonder.runtime-note",
			data: { from: "system:yonder", text },
			model: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: `<runtime_notice source="system:yonder">${text}</runtime_notice>` }],
					timestamp: Date.now(),
				},
			],
		},
	};
}
