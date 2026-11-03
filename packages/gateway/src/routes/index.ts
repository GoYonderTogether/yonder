import type { Server } from "node:http";
import type { HostCtx } from "@yonder/local-host";
import { mount as mountAttachments } from "./attachments.js";
import { mount as mountShell } from "./shell.js";

export function mountRoutes(app: Server, ctx: Omit<HostCtx, "principal" | "gateway">): void {
	mountAttachments(app, ctx);
	mountShell(app, ctx);
}
