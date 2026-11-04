import { randomUUID } from "node:crypto";
import {
	type CommandReceipt,
	commandDigest,
	commandKey,
	type DeviceSession,
	decodeCommand,
	OriginSchema,
	type RpcRequest,
} from "@yonder/protocol";
import { Check } from "typebox/value";
import type { CommandDeps } from "./executor-deps.js";
import { fail, now } from "./executor-support.js";

export async function operateRpc(deps: CommandDeps, request: RpcRequest, commit: (result: unknown) => void) {
	const { deviceId, backend, store } = deps;
	const p = request.principalId;
	switch (request.method) {
		case "device.describe": {
			const descriptor = await backend.describe();
			if (descriptor.deviceId !== deviceId || descriptor.checkpointRestore !== "unsupported") fail("INVALID_REQUEST");
			const targets = descriptor.targets.filter((t) => {
				try {
					deps.grant(p, t.id, "read");
					return true;
				} catch {
					return false;
				}
			});
			if (!targets.length) fail("UNAUTHORIZED");
			const visible = new Set(targets.map((t) => t.id));
			return { ...descriptor, targets, capabilities: descriptor.capabilities.filter((c) => visible.has(c.scope)) };
		}
		case "device.apps.list": {
			deps.grant(p, request.params.targetId, "read");
			const inventory = await backend.apps(request.params.targetId);
			if (inventory.deviceId !== deviceId || inventory.targetId !== request.params.targetId) fail("INVALID_REQUEST");
			return inventory;
		}
		case "device.ui.snapshot": {
			const session = deps.session(p, request.params.deviceSessionId);
			deps.authorizeSession(session, ["read"]);
			const snapshot = await backend.snapshot(session);
			if (
				snapshot.deviceId !== deviceId ||
				snapshot.deviceSessionId !== session.deviceSessionId ||
				snapshot.targetId !== session.targetId
			)
				fail("INVALID_REQUEST");
			return snapshot;
		}
		case "device.sessions.open": {
			const { targetId, grantId, capabilities, origin } = request.params;
			if (!Check(OriginSchema, origin) || !capabilities.length || !capabilities.includes("read"))
				fail("INVALID_REQUEST");
			const grant = store.data.grants[grantId];
			if (!grant || grant.principalId !== p || !grant.targetIds.includes(targetId)) throw new Error("UNAUTHORIZED");
			deps.grant(p, targetId, "read");
			if (grant.revokedAt) fail("GRANT_REVOKED");
			if (Date.parse(grant.expiresAt) <= Date.now()) fail("GRANT_EXPIRED");
			if (capabilities.some((c) => !grant.capabilities.includes(c))) fail("UNAUTHORIZED");
			const descriptor = await backend.describe();
			if (!descriptor.targets.some((t) => t.id === targetId)) fail("WRONG_TARGET");
			if (grant.revokedAt) fail("GRANT_REVOKED");
			if (Date.parse(grant.expiresAt) <= Date.now()) fail("GRANT_EXPIRED");
			const epoch = (store.data.leaseEpochs[targetId] ?? 0) + 1;
			const session: DeviceSession = {
				deviceSessionId: randomUUID(),
				deviceId,
				principalId: p,
				targetId,
				grantId,
				grantRevision: grant.revision,
				leaseEpoch: epoch,
				capabilities,
				origin,
				expiresAt: new Date(Math.min(Date.now() + 300_000, Date.parse(grant.expiresAt))).toISOString(),
			};
			store.data.leaseEpochs[targetId] = epoch;
			store.data.sessions[session.deviceSessionId] = session;
			commit(session);
			return session;
		}
		case "device.sessions.close": {
			const session = deps.session(p, request.params.deviceSessionId);
			store.data.leaseEpochs[session.targetId] = session.leaseEpoch + 1;
			commit({ closed: true });
			return { closed: true };
		}
		case "commands.submit": {
			const command = decodeCommand(request.params.commandBase64, { deviceId, principalId: p });
			const key = commandKey(command);
			const existing = store.data.commands[key];
			if (existing) {
				if (existing.receipt.payloadSha256 !== commandDigest(request.params.commandBase64)) fail("COMMAND_CONFLICT");
				deps.session(p, command.deviceSessionId);
				return existing.receipt;
			}
			const session = deps.session(p, command.deviceSessionId);
			if (command.leaseEpoch !== session.leaseEpoch) fail("LEASE_STALE");
			const action = backend.actions[command.action];
			if (!action) throw new Error("UNSUPPORTED_OPERATION");
			if (!action.validate(command.arguments)) fail("INVALID_REQUEST");
			deps.authorizeSession(session, action.capabilities, command.action);
			const resources = action.resources?.(command.arguments) ?? { readRoots: [], writeRoots: [] };
			deps.authorizeResources(session, resources.readRoots, resources.writeRoots);
			if (action.mutatesDevice && deps.busy()) fail("BUSY");
			const acceptedAt = now();
			const receipt: CommandReceipt = {
				deviceId,
				principalId: p,
				commandId: command.commandId,
				deviceSessionId: command.deviceSessionId,
				payloadSha256: commandDigest(request.params.commandBase64),
				state: "accepted",
				acceptedAt,
				updatedAt: acceptedAt,
			};
			const acceptedGrant = store.data.grants[session.grantId];
			if (!acceptedGrant) throw new Error("UNAUTHORIZED");
			store.data.commands[key] = {
				receipt,
				commandBase64: request.params.commandBase64,
				targetId: session.targetId,
				action: command.action,
				readRoots: [...resources.readRoots],
				writeRoots: [...resources.writeRoots],
			};
			commit(receipt);
			queueMicrotask(() => deps.startDispatch(key));
			return receipt;
		}
		case "commands.status":
			return deps.query(p, request.params.commandId);
		case "commands.cancel": {
			const { key, record } = deps.record(p, request.params.commandId);
			deps.grant(p, record.targetId, "exec", record.action);
			if (record.receipt.state === "accepted") {
				record.receipt.state = "cancelled";
				record.receipt.updatedAt = now();
				commit(record.receipt);
			} else if (record.receipt.state === "running") {
				const running = deps.running.get(key);
				if (!running) throw new Error("OUTCOME_UNKNOWN");
				running.abort.abort();
				await running.done;
			}
			return record.receipt;
		}
		case "grants.list":
			// Only the paired principal's own grants; the owner view is a separate cloud path.
			return store.summaries().filter((grant) => grant.principalId === p);
		case "grants.revoke":
			store.revoke(p, request.params.grantId, false);
			commit({ revoked: true });
			return { revoked: true };
	}
}
