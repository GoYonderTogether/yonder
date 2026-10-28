import type { Server } from "node:http";
import type { HostCtx } from "@yonder/core";

export function mount(_app: Server, _ctx: Omit<HostCtx, "principal" | "gateway">): void {}
