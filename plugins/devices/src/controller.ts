import { arch, machine, platform, release } from "node:os";
import {
	type AppInventory,
	AppInventorySchema,
	type CommandReceipt,
	CommandReceiptSchema,
	commandDigest,
	type DeviceDescriptor,
	DeviceDescriptorSchema,
	type DeviceSession,
	DeviceSessionSchema,
	decodeCommand,
	type ExecutionCapability,
	encodeCommand,
	type Grant,
	GrantSchema,
	type Origin,
	publicKeyId,
	type ToolContext,
	type TSchema,
	type UiSnapshot,
	UiSnapshotSchema,
} from "@yonder/sdk";
import { Check } from "typebox/value";
import { ControllerStore } from "./store.js";
import { type DeviceRegistry, type RegisteredDevice, RemoteError, rpc, UnconfirmedRequest } from "./transport.js";

export const executeCapabilities: ExecutionCapability[] = ["read", "write", "exec", "network", "message"];
const readCapabilities: ExecutionCapability[] = ["read", "network"];
function requireCaps(ctx: ToolContext, caps: readonly ExecutionCapability[]): void {
	ctx.signal.throwIfAborted();
	if (!caps.every((c) => ctx.capabilities.includes(c)))
		throw new RemoteError("UNAUTHORIZED", "Missing effective tool capabilities");
}
function origin(ctx: ToolContext): Origin {
	return { agentId: ctx.agent, profileId: ctx.profile, modelSessionId: ctx.session };
}
function sameOrigin(a: Origin, b: Origin): boolean {
	return a.agentId === b.agentId && a.profileId === b.profileId && a.modelSessionId === b.modelSessionId;
}
function checked<T>(schema: TSchema, value: unknown): T {
	if (!Check(schema, value)) throw new Error("Invalid execution response");
	return value as T;
}

export class DeviceController {
	readonly store: ControllerStore;
	constructor(
		data: string,
		private readonly registry: DeviceRegistry,
	) {
		this.store = new ControllerStore(data);
	}
	private async device(deviceId: string): Promise<RegisteredDevice> {
		const matches = (await this.registry()).filter((d) => d.deviceId === deviceId);
		if (matches.length !== 1)
			throw new RemoteError("UNPAIRED", "Device is not uniquely registered by trusted pairing management");
		const device = matches[0];
		if (!device) throw new RemoteError("UNPAIRED", "No device registration");
		if (device.controllerKey.type !== "private")
			throw new RemoteError("UNPAIRED", "Controller signing key unavailable");
		publicKeyId(device.deviceKey);
		return device;
	}
	private grants(device: RegisteredDevice, ctx: ToolContext, capability: "read" | "exec" = "read"): Grant[] {
		const principalId = publicKeyId(device.controllerKey);
		return device.grants.filter(
			(g) =>
				Check(GrantSchema, g) &&
				g.deviceId === device.deviceId &&
				g.principalId === principalId &&
				g.revokedAt === null &&
				Date.parse(g.issuedAt) <= Date.now() &&
				Date.parse(g.expiresAt) > Date.now() &&
				g.capabilities.includes(capability) &&
				ctx.capabilities.includes(capability),
		);
	}
	async list(ctx: ToolContext): Promise<unknown> {
		requireCaps(ctx, ["read"]);
		const devices = await this.registry();
		const entries = await Promise.all(
			devices.map(async (device) => {
				const grants = this.grants(device, ctx);
				const cached = await this.store.cached(device.deviceId);
				const lastKnown = cached === undefined ? undefined : checked<DeviceDescriptor>(DeviceDescriptorSchema, cached);
				if (lastKnown && lastKnown.deviceId !== device.deviceId) throw new Error("WRONG_TARGET");
				return {
					deviceId: device.deviceId,
					name: device.name,
					capabilities: executeCapabilities.filter(
						(c) => ctx.capabilities.includes(c) && grants.some((g) => g.capabilities.includes(c)),
					),
					connectivity: device.routes.length ? "unknown" : "offline",
					authorization: grants.length ? "granted" : "no-current-read-grant",
					...(grants.length && lastKnown ? { lastKnown, freshness: "cached; use devices_describe to refresh" } : {}),
				};
			}),
		);
		return {
			host: {
				os: platform(),
				osVersion: release(),
				machine: machine(),
				processArch: arch(),
				runtimeVersion: process.version,
			},
			executionEnv: { id: ctx.env.id, cwd: ctx.env.cwd },
			devices: entries,
			...(entries.length ? {} : { reason: "No trusted device registrations supplied by pairing management" }),
			checkpointRestore: "unsupported",
		};
	}
	private async readable(deviceId: string, ctx: ToolContext): Promise<RegisteredDevice> {
		requireCaps(ctx, readCapabilities);
		const device = await this.device(deviceId);
		if (!this.grants(device, ctx).length) throw new RemoteError("UNAUTHORIZED", "No current device read grant");
		return device;
	}
	async describe(deviceId: string, ctx: ToolContext): Promise<DeviceDescriptor> {
		const device = await this.readable(deviceId, ctx);
		const result = checked<DeviceDescriptor>(
			DeviceDescriptorSchema,
			await rpc(device, "device.describe", {}, ctx.signal),
		);
		if (result.deviceId !== deviceId) throw new Error("WRONG_TARGET");
		await this.store.cache(result);
		return result;
	}
	async apps(deviceId: string, targetId: string, ctx: ToolContext): Promise<AppInventory> {
		const device = await this.readable(deviceId, ctx);
		if (!this.grants(device, ctx).some((g) => g.targetIds.includes(targetId)))
			throw new RemoteError("UNAUTHORIZED", "Target outside current device grants");
		const result = checked<AppInventory>(
			AppInventorySchema,
			await rpc(device, "device.apps.list", { targetId }, ctx.signal),
		);
		if (result.deviceId !== deviceId || result.targetId !== targetId) throw new Error("WRONG_TARGET");
		return result;
	}
	async open(deviceId: string, targetId: string, ctx: ToolContext): Promise<DeviceSession> {
		const device = await this.readable(deviceId, ctx);
		const grants = this.grants(device, ctx).filter((g) => g.targetIds.includes(targetId));
		// One concrete grant backs a session; never union separate grants into broader authority.
		grants.sort(
			(a, b) =>
				b.capabilities.filter((c) => ctx.capabilities.includes(c)).length -
					a.capabilities.filter((c) => ctx.capabilities.includes(c)).length || a.grantId.localeCompare(b.grantId),
		);
		const grant = grants[0];
		if (!grant) throw new RemoteError("UNAUTHORIZED", "No current grant for target");
		const capabilities = executeCapabilities.filter(
			(c) => ctx.capabilities.includes(c) && grant.capabilities.includes(c),
		);
		const owner = origin(ctx);
		const result = checked<DeviceSession>(
			DeviceSessionSchema,
			await rpc(
				device,
				"device.sessions.open",
				{
					targetId,
					grantId: grant.grantId,
					capabilities,
					origin: owner,
				},
				ctx.signal,
			),
		);
		if (
			result.deviceId !== deviceId ||
			result.principalId !== publicKeyId(device.controllerKey) ||
			result.targetId !== targetId ||
			result.grantId !== grant.grantId ||
			result.grantRevision !== grant.revision ||
			!sameOrigin(result.origin, owner) ||
			!result.capabilities.includes("read") ||
			!result.capabilities.every((c) => capabilities.includes(c)) ||
			Date.parse(result.expiresAt) <= Date.now() ||
			Date.parse(result.expiresAt) > Date.parse(grant.expiresAt)
		)
			throw new Error("Invalid device session authority");
		await this.store.saveSession({ session: result, closed: false });
		return result;
	}
	private async owned(device: RegisteredDevice, id: string, ctx: ToolContext, active = true): Promise<DeviceSession> {
		const value = await this.store.session(device.deviceId, publicKeyId(device.controllerKey), id);
		if (!sameOrigin(value.session.origin, origin(ctx))) throw new RemoteError("UNAUTHORIZED", "Foreign device session");
		if (active && value.closed) throw new RemoteError("LEASE_STALE", "Device session is closing or closed");
		if (active && Date.parse(value.session.expiresAt) <= Date.now())
			throw new RemoteError("LEASE_EXPIRED", "Use status to inspect old commands");
		return value.session;
	}
	private currentGrant(device: RegisteredDevice, session: DeviceSession, ctx: ToolContext): Grant {
		const grant = this.grants(device, ctx).find(
			(g) =>
				g.grantId === session.grantId && g.revision === session.grantRevision && g.targetIds.includes(session.targetId),
		);
		if (!grant) throw new RemoteError("UNAUTHORIZED", "Session grant is no longer current");
		return grant;
	}
	async observe(deviceId: string, id: string, ctx: ToolContext): Promise<UiSnapshot> {
		const device = await this.readable(deviceId, ctx);
		const session = await this.owned(device, id, ctx);
		this.currentGrant(device, session, ctx);
		const result = checked<UiSnapshot>(
			UiSnapshotSchema,
			await rpc(device, "device.ui.snapshot", { deviceSessionId: id }, ctx.signal),
		);
		if (result.deviceId !== deviceId || result.deviceSessionId !== id || result.targetId !== session.targetId)
			throw new Error("WRONG_TARGET");
		return result;
	}
	private receipt(
		value: unknown,
		device: RegisteredDevice,
		commandId: string,
		pending?: { payloadSha256: string; deviceSessionId: string },
	): CommandReceipt {
		const result = checked<CommandReceipt>(CommandReceiptSchema, value);
		if (
			result.deviceId !== device.deviceId ||
			result.principalId !== publicKeyId(device.controllerKey) ||
			result.commandId !== commandId ||
			(pending &&
				(result.payloadSha256 !== pending.payloadSha256 || result.deviceSessionId !== pending.deviceSessionId))
		)
			throw new Error("WRONG_TARGET");
		return result;
	}
	async status(deviceId: string, commandId: string, ctx: ToolContext): Promise<CommandReceipt> {
		const device = await this.readable(deviceId, ctx);
		const pending = await this.store.command(deviceId, publicKeyId(device.controllerKey), commandId);
		return this.receipt(
			await rpc(device, "commands.status", { commandId }, ctx.signal),
			device,
			commandId,
			pending
				? {
						payloadSha256: pending.payloadSha256,
						deviceSessionId: decodeCommand(pending.commandBase64, {
							deviceId,
							principalId: publicKeyId(device.controllerKey),
						}).deviceSessionId,
					}
				: undefined,
		);
	}
	async execute(
		deviceId: string,
		id: string,
		commandId: string,
		action: string,
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<CommandReceipt> {
		requireCaps(ctx, executeCapabilities);
		const device = await this.readable(deviceId, ctx);
		const principalId = publicKeyId(device.controllerKey);
		const pending = await this.store.command(deviceId, principalId, commandId);
		if (pending) {
			const saved = decodeCommand(pending.commandBase64, { deviceId, principalId });
			const requested = encodeCommand({ ...saved, deviceSessionId: id, action, arguments: args });
			if (commandDigest(requested) !== pending.payloadSha256)
				throw new RemoteError("COMMAND_CONFLICT", "Command ID already has different bytes");
			return this.status(deviceId, commandId, ctx);
		}
		const session = await this.owned(device, id, ctx);
		const grant = this.currentGrant(device, session, ctx);
		if (
			!session.capabilities.every((c) => ctx.capabilities.includes(c) && grant.capabilities.includes(c)) ||
			!grant.actions.includes(action)
		)
			throw new RemoteError("UNAUTHORIZED", "Action or session authority outside current grant");
		const commandBase64 = encodeCommand({
			deviceId,
			principalId,
			commandId,
			deviceSessionId: id,
			leaseEpoch: session.leaseEpoch,
			action,
			arguments: args,
		});
		const payloadSha256 = commandDigest(commandBase64);
		const prepared = await this.store.prepare(deviceId, principalId, commandId, {
			commandBase64,
			payloadSha256,
			targetId: session.targetId,
			origin: origin(ctx),
			preparedAt: new Date().toISOString(),
		});
		// Another caller/restarted controller that already prepared this ID may only query it.
		if (!prepared) return this.execute(deviceId, id, commandId, action, args, ctx);
		ctx.signal.throwIfAborted();
		try {
			return this.receipt(await rpc(device, "commands.submit", { commandBase64 }, ctx.signal), device, commandId, {
				payloadSha256,
				deviceSessionId: id,
			});
		} catch (error) {
			if (error instanceof RemoteError) throw error;
			// Query across routes with the existing identity; never resubmit or allocate a replacement ID.
			try {
				return await this.status(deviceId, commandId, ctx);
			} catch {
				throw new RemoteError(
					"OUTCOME_UNKNOWN",
					`Command ${commandId} has no confirmed outcome; use devices_status with the same deviceId/commandId`,
				);
			}
		}
	}
	async cancel(deviceId: string, commandId: string, ctx: ToolContext): Promise<CommandReceipt> {
		requireCaps(ctx, ["exec", "network"]);
		const device = await this.device(deviceId);
		const pending = await this.store.command(deviceId, publicKeyId(device.controllerKey), commandId);
		if (!this.grants(device, ctx, "exec").some((g) => !pending || g.targetIds.includes(pending.targetId)))
			throw new RemoteError("UNAUTHORIZED", "No current device cancellation grant");
		return this.receipt(
			await rpc(device, "commands.cancel", { commandId }, ctx.signal),
			device,
			commandId,
			pending
				? {
						payloadSha256: pending.payloadSha256,
						deviceSessionId: decodeCommand(pending.commandBase64, {
							deviceId,
							principalId: publicKeyId(device.controllerKey),
						}).deviceSessionId,
					}
				: undefined,
		);
	}
	async close(deviceId: string, id: string, ctx: ToolContext): Promise<{ closed: true }> {
		requireCaps(ctx, readCapabilities);
		const device = await this.device(deviceId);
		const session = await this.owned(device, id, ctx, false);
		// Revoke the local handle before IO; a lost close response cannot leave it usable for writes.
		await this.store.saveSession({ session, closed: true });
		const result = await rpc(device, "device.sessions.close", { deviceSessionId: id }, ctx.signal);
		if (
			!Check(
				{ type: "object", additionalProperties: false, required: ["closed"], properties: { closed: { const: true } } },
				result,
			)
		)
			throw new Error("Invalid close response");
		return { closed: true };
	}
}

export function toolError(error: unknown): {
	code: string;
	message: string;
	requestId?: string;
	connectivity?: string;
} {
	if (error instanceof RemoteError) return { code: error.code, message: error.message };
	if (error instanceof UnconfirmedRequest)
		return {
			code: "OUTCOME_UNKNOWN",
			message: error.message,
			requestId: error.requestId,
			connectivity: error.connectivity,
		};
	return { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
}
