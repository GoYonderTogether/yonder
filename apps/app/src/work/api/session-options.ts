import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { request } from "../../api/http";
import { gatewayHosted } from "../../lib/base";
import { $session } from "../../store";
import { type NodeTarget, rpc } from "./client";
import { type NodeConfig, useNodes } from "./nodes";

export interface SessionOptions {
	model?: string;
	effort?: string;
	permission?: string;
	resources?: { deviceId: string; paths: string[] }[];
}
export interface ModelChoice {
	id: string;
	provider: string;
	name: string;
	source: "runtime" | "cloud";
	reasoning: boolean;
	effortLevels: string[];
	available?: boolean;
	reason?: string;
}
export interface PermissionChoice {
	id: string;
	name: string;
	level: string;
	capabilities: string[];
}
export interface ModelCatalog {
	providers: { id: string; name: string; models: ModelChoice[] }[];
	permissions: PermissionChoice[];
	cloud?: {
		issues: {
			instance: string;
			code: "not_connected" | "http_error" | "network_error" | "invalid_catalog";
			message: string;
		}[];
	};
}
export interface WorkspaceDevice {
	deviceId: string;
	name: string;
	status: "ready" | "unknown" | "offline" | "degraded";
	targets: { id: string; name: string }[];
	paths: string[];
}
export interface RuntimeChoice extends NodeConfig {
	kind?: "cloud" | "device";
	online?: boolean;
	workProtocol?: number;
}
export interface CloudRuntime {
	id: string;
	deviceId: string;
	name: string;
	kind: "cloud" | "device";
	online: boolean;
	workProtocol?: number;
}

export function useRuntimes() {
	const account = useStore($session)?.actor;
	const saved = useNodes();
	const cloud = useQuery({
		queryKey: ["runtimes", account?.id],
		enabled: !!account && !account.anonymous,
		queryFn: () => request<{ runtimes: CloudRuntime[] }>("/runtimes"),
		retry: false,
		refetchInterval: 5000,
	});
	const runtimes: RuntimeChoice[] = [
		...(gatewayHosted() || import.meta.env.VITE_API !== "http" ? saved.filter((node) => !node.deviceId) : []),
		...(account ? (cloud.data?.runtimes ?? []) : []).map((runtime) => ({
			...runtime,
			id: `account:${account?.id}:device:${runtime.deviceId}`,
		})),
	];
	return { runtimes, accountId: account?.id, error: cloud.error, loading: cloud.isLoading };
}

export const readModels = (node: NodeTarget, signal?: AbortSignal) =>
	rpc<ModelCatalog>("models.list", {}, signal, node);
export const readWorkspaces = (node: NodeTarget, signal?: AbortSignal, id?: string) =>
	rpc<{ devices: WorkspaceDevice[] }>("workspaces.list", id ? { id } : {}, signal, node);

export function modelKey(model: ModelChoice): string {
	return `${model.provider}/${model.id}`;
}

export function selectDevice(resources: NonNullable<SessionOptions["resources"]>, deviceId: string, checked: boolean) {
	return checked
		? [...resources.filter((item) => item.deviceId !== deviceId), { deviceId, paths: [] }]
		: resources.filter((item) => item.deviceId !== deviceId);
}

export function selectPath(
	resources: NonNullable<SessionOptions["resources"]>,
	deviceId: string,
	path: string,
	checked: boolean,
) {
	const existing = resources.find((item) => item.deviceId === deviceId)?.paths ?? [];
	const paths = checked ? [...new Set([...existing, path])] : existing.filter((item) => item !== path);
	return [...resources.filter((item) => item.deviceId !== deviceId), { deviceId, paths }];
}
