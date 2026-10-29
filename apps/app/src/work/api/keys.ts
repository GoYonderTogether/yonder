export const qk = {
	socialSession: ["social-session"] as const,
	sessions: (node = "local") => [node, "sessions"] as const,
	session: (id: string, node = "local") => [node, "session", id] as const,
	views: (placement: string, session: string, node = "local") => [node, "views", placement, session] as const,
	capabilities: (node = "local") => [node, "capabilities"] as const,
	update: (node = "local") => [node, "update"] as const,
	/** 工作列表：含已归档的合并列表，前缀仍是 ["sessions"]，变更后一并失效。 */
	workSessions: ["sessions", "work"] as const,
	botOverview: (bot: string, node = "local") => [node, "bot-overview", bot] as const,
};
