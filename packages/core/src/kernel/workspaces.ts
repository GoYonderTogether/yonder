import { randomUUID } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Tool, ToolContext, WorkspaceResource } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import { localEnvironment } from "../runtime/index.js";
import type { RuntimeSessionConfig } from "../runtime/types.js";
import { deviceOperation } from "./device-operation.js";

interface DeviceEntry {
	deviceId: string;
	name?: string;
	connectivity: string;
	grants: Array<{ targetIds: string[]; readRoots?: string[]; writeRoots?: string[] }>;
	lastKnown?: { targets: Array<{ id: string; name?: string }> };
}
export function createWorkspaces(home: string, config: YonderConfig, tools: Map<string, Tool[]>) {
	const operation = deviceOperation(home, tools);
	const context = (signal: AbortSignal, scope?: RuntimeSessionConfig): ToolContext => ({
		agent: scope?.agent ?? null,
		profile: scope?.profile ?? "owner-workbench",
		session: scope?.sessionId ?? "owner-workbench",
		capabilities: ["read"],
		...(scope?.resources ? { resources: scope.resources } : {}),
		env: localEnvironment(home),
		signal,
	});
	async function devices(signal: AbortSignal, scope?: RuntimeSessionConfig) {
		const list = tools.get("devices")?.find((tool) => tool.name === "devices_list");
		const result = list ? await list.execute({}, context(signal, scope)) : undefined;
		if (result?.isError) throw new Error(result.text);
		const remote = result ? (JSON.parse(result.text) as { devices: DeviceEntry[] }).devices : [];
		const local = scope?.resources?.find((resource) => resource.deviceId === "local");
		return [
			...(!scope?.resources?.length || local
				? [
						{
							deviceId: "local",
							name: hostname(),
							status: "ready",
							targets: [{ id: "local", name: hostname() }],
							paths: local?.paths.length
								? local.paths
								: [
										...new Set([
											home,
											...(config.agents ?? [])
												.filter((agent) => !agent.env || agent.env === "local")
												.map((agent) => resolve(home, agent.workspace)),
										]),
									],
						},
					]
				: []),
			...remote
				.filter((device) => device.grants.length)
				.map((device) => {
					const selected = scope?.resources?.find((resource) => resource.deviceId === device.deviceId);
					return {
						deviceId: device.deviceId,
						name: device.name ?? device.deviceId,
						status: device.connectivity,
						targets:
							device.lastKnown?.targets ??
							[...new Set(device.grants.flatMap((grant) => grant.targetIds))].map((id) => ({ id, name: id })),
						paths: selected?.paths.length
							? selected.paths
							: [
									...new Set(
										device.grants.flatMap((grant) => [...(grant.readRoots ?? []), ...(grant.writeRoots ?? [])]),
									),
								],
					};
				}),
		];
	}
	async function localPath(path: string, scope?: RuntimeSessionConfig) {
		if (!isAbsolute(path)) throw new Error("Workspace path must be absolute on the selected device");
		const canonical = await realpath(path);
		const roots = scope?.resources?.find((resource) => resource.deviceId === "local")?.paths;
		if (scope?.resources?.length && !scope.resources.some((resource) => resource.deviceId === "local"))
			throw new Error("Runtime host is outside session resources");
		if (
			roots?.length &&
			!(await Promise.all(roots.map((root) => realpath(root)))).some((root) => {
				const rel = relative(root, canonical);
				return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
			})
		)
			throw new Error("Path outside authorized session resources");
		if (!(await stat(canonical)).isDirectory()) throw new Error("Workspace is not a directory");
		return canonical;
	}
	async function remoteCall(
		deviceId: string,
		action: string,
		path: string,
		signal: AbortSignal,
		scope?: RuntimeSessionConfig,
	) {
		const selected = (await devices(signal, scope)).find((device) => device.deviceId === deviceId);
		if (!selected) throw new Error("Device is outside authorized session resources");
		const base =
			scope ??
			({
				agent: null,
				profile: "owner-workbench",
				cwd: home,
				resolved: { capabilities: ["read"] },
			} as RuntimeSessionConfig);
		const value = (await operation(
			{ ...base, resolved: { ...base.resolved, capabilities: ["read"] } },
			deviceId,
			randomUUID(),
			action,
			{ path },
			signal,
		)) as { error?: { message: string } };
		if (value?.error) throw new Error(value.error.message);
		return value;
	}
	return {
		devices,
		async list(request: { deviceId?: string; path?: string }, signal: AbortSignal, scope?: RuntimeSessionConfig) {
			if (request.path !== undefined) {
				if (request.deviceId !== "local") {
					if (!request.deviceId) throw new Error("Select a device first");
					const entries = (await remoteCall(
						request.deviceId,
						"fs.list",
						request.path,
						signal,
						scope,
					)) as unknown as Array<{ name: string; path: string; kind: string }>;
					return {
						deviceId: request.deviceId,
						path: request.path,
						entries: entries
							.filter((entry) => entry.kind === "directory")
							.map((entry) => ({ name: entry.name, path: entry.path, type: "directory" as const })),
					};
				}
				const path = await localPath(request.path, scope),
					entries = await readdir(path, { withFileTypes: true });
				return {
					deviceId: "local",
					path,
					entries: entries
						.filter((entry) => entry.isDirectory())
						.map((entry) => ({ name: entry.name, path: resolve(path, entry.name), type: "directory" as const })),
				};
			}
			return { devices: await devices(signal, scope) };
		},
		async validate(
			resources: WorkspaceResource[],
			signal: AbortSignal,
			scope?: RuntimeSessionConfig,
		): Promise<WorkspaceResource[]> {
			const available = await devices(signal, scope),
				seen = new Set<string>();
			return Promise.all(
				resources.map(async (resource) => {
					if (seen.has(resource.deviceId)) throw new Error("Duplicate resource device");
					seen.add(resource.deviceId);
					if (!available.some((device) => device.deviceId === resource.deviceId))
						throw new Error("Device is not authorized for this session");
					const inherited = scope?.resources?.find((item) => item.deviceId === resource.deviceId)?.paths;
					const paths = await Promise.all(
						(resource.paths.length ? resource.paths : (inherited ?? [])).map(async (path) => {
							if (resource.deviceId === "local") return localPath(path, scope);
							const canonical = (await remoteCall(
								resource.deviceId,
								"fs.canonical",
								path,
								signal,
								scope,
							)) as unknown as string;
							const info = (await remoteCall(resource.deviceId, "fs.stat", canonical, signal, scope)) as {
								kind?: string;
							};
							if (info.kind !== "directory") throw new Error("Workspace is not a directory");
							return canonical;
						}),
					);
					return { deviceId: resource.deviceId, paths: [...new Set(paths)] };
				}),
			);
		},
	};
}
