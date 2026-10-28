export const qk = {
	sessions: (node = "local") => [node, "sessions"] as const,
	session: (id: string, node = "local") => [node, "session", id] as const,
	views: (placement: string, session: string, node = "local") => [node, "views", placement, session] as const,
	capabilities: (node = "local") => [node, "capabilities"] as const,
};
