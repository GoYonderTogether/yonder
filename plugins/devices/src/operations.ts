import { setTimeout as delay } from "node:timers/promises";
import { type DeviceSession, decodeCommand, publicKeyId, type ToolContext } from "@yonder/sdk";
import type { DeviceController } from "./controller.js";
import { type RegisteredDevice, RemoteError } from "./transport.js";

const origin = (ctx: ToolContext) => ({ agentId: ctx.agent, profileId: ctx.profile, modelSessionId: ctx.session });
export async function operate(
	controller: DeviceController,
	device: RegisteredDevice,
	deviceId: string,
	commandId: string,
	action: string,
	args: Record<string, unknown>,
	ctx: ToolContext,
	sessions: Map<string, Promise<DeviceSession>>,
): Promise<unknown> {
	const pending = await controller.store.command(deviceId, publicKeyId(device.controllerKey), commandId);
	if (pending && JSON.stringify(pending.origin) !== JSON.stringify(origin(ctx)))
		throw new RemoteError("UNAUTHORIZED", "Foreign command");
	const selected = ctx.resources?.find((resource) => resource.deviceId === deviceId);
	const { scopeRoots: _ignored, ...input } = args;
	const scoped = { ...input, ...(selected?.paths.length ? { scopeRoots: selected.paths } : {}) };
	const key = JSON.stringify([deviceId, origin(ctx), ctx.capabilities, ctx.resources]);
	let sessionId: string;
	if (pending)
		sessionId = decodeCommand(pending.commandBase64, {
			deviceId,
			principalId: publicKeyId(device.controllerKey),
		}).deviceSessionId;
	else {
		let session = sessions.get(key);
		if (!session) {
			for (const old of sessions.keys()) if (JSON.parse(old)[0] === deviceId) sessions.delete(old);
			session = controller.open(deviceId, "host:filesystem", ctx);
			sessions.set(key, session);
			session.catch(() => sessions.delete(key));
		}
		const handle = await session;
		if (Date.parse(handle.expiresAt) <= Date.now()) {
			sessions.delete(key);
			throw new RemoteError("LEASE_EXPIRED", "Device session expired; start a new operation");
		}
		sessionId = handle.deviceSessionId;
	}
	try {
		let receipt = await controller.execute(deviceId, sessionId, commandId, action, scoped, ctx);
		while (receipt.state === "accepted" || receipt.state === "running") {
			await delay(100, undefined, { signal: ctx.signal });
			receipt = await controller.status(deviceId, commandId, ctx);
		}
		if (receipt.state !== "succeeded")
			throw new RemoteError(
				receipt.error?.code ?? "OUTCOME_UNKNOWN",
				receipt.error?.message ?? `Command ${commandId}: ${receipt.state}`,
			);
		return receipt.result;
	} catch (error) {
		if (ctx.signal.aborted && ctx.capabilities.includes("exec")) {
			const cancellation = await controller.cancel(deviceId, commandId, {
				...ctx,
				signal: AbortSignal.timeout(10_000),
			});
			if (cancellation.state !== "cancelled" && cancellation.state !== "succeeded" && cancellation.state !== "failed")
				throw new RemoteError("OUTCOME_UNKNOWN", `Cancellation unconfirmed for ${commandId}`);
		}
		throw error;
	}
}
