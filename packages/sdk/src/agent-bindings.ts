import type { ExecutionOwner, Ref, ToolContext } from "./types.js";

export interface AgentBindingRequest {
	id: string;
	eventType: string;
	conv: Ref;
	profile: string;
	notification: { to: Ref | "owner"; via: string };
}
export interface AgentBindingRoute {
	binding: string;
	profile: string;
	conv: Ref;
	notification: { to: Ref; via: string };
	owner: ExecutionOwner;
}
export interface AgentsAPI {
	list(): Promise<{ id: string; name: string; avatarUrl?: string }[]>;
	configureBinding(request: AgentBindingRequest, ctx: ToolContext): Promise<AgentBindingRoute>;
	inspectBinding(request: AgentBindingRequest, owner: ExecutionOwner): Promise<AgentBindingRoute>;
}
