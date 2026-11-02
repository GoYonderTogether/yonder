import { generateKeyPairSync, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { type RpcRequest, type RpcResponse, type SignedEnvelope, signMessage } from "@yonder/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { type RegisteredDevice, rpc } from "../src/transport.js";

const now = 1_700_000_000_000;
const controller = generateKeyPairSync("ed25519");
const executor = generateKeyPairSync("ed25519");
afterEach(() => vi.restoreAllMocks());

function fixture(offset: number, change?: (response: RpcResponse) => RpcResponse, corrupt = false) {
	let sends = 0;
	let received: SignedEnvelope | undefined;
	const device: RegisteredDevice = {
		deviceId: randomUUID(),
		name: "isolated clock test",
		controllerKey: controller.privateKey,
		deviceKey: executor.publicKey,
		grants: [],
		routes: [
			{
				kind: "direct",
				exchange: async (envelope) => {
					sends++;
					const {
						method: _method,
						params: _params,
						...header
					} = JSON.parse(Buffer.from(envelope.payloadBase64, "base64").toString()) as RpcRequest;
					const response: RpcResponse = {
						...header,
						kind: "response",
						issuedAt: now + offset,
						expiresAt: now + offset + 60_000,
						ok: true,
						result: { verified: true },
					};
					received = signMessage(change ? change(response) : response, executor.privateKey);
					if (corrupt) received.signatureBase64 = Buffer.alloc(64).toString("base64");
					return received;
				},
			},
		],
	};
	return {
		device,
		sends: () => sends,
		received: () => received,
		call: (signal = new AbortController().signal) =>
			rpc(device, "device.sessions.close", { deviceSessionId: randomUUID() }, signal),
	};
}

it.each([1, 2, 3])("waits for local time to reach a signed response %ims ahead, without resending", async (offset) => {
	let clock = now;
	vi.spyOn(Date, "now").mockImplementation(() => clock);
	const test = fixture(offset);
	let settled = false;
	const result = test.call().then((value) => {
		settled = true;
		return value;
	});
	await delay(10);
	expect(settled).toBe(false);
	clock = now + offset - 1;
	await delay(10);
	expect(settled).toBe(false);
	clock = now + offset;
	await expect(result).resolves.toEqual({ verified: true });
	expect(test.sends()).toBe(1);
});

it.each(["signature", "binding", "expired", "invalid-window"] as const)(
	"rejects %s without waiting for a future response",
	async (kind) => {
		vi.spyOn(Date, "now").mockReturnValue(now);
		const test = fixture(
			30_000,
			(response) => {
				if (kind === "binding") return { ...response, requestId: randomUUID() };
				if (kind === "expired") return { ...response, issuedAt: now - 10, expiresAt: now };
				if (kind === "invalid-window") return { ...response, expiresAt: response.issuedAt };
				return response;
			},
			kind === "signature",
		);
		const outcome = await Promise.race([test.call().catch((error) => error), delay(50, "still waiting")]);
		expect(outcome).toMatchObject({ connectivity: "unknown", diagnostic: { stage: "authentication" } });
		expect(test.sends()).toBe(1);
	},
);

it.each(["caller", "route budget"] as const)("cancels the local wait at the original %s signal", async (owner) => {
	vi.spyOn(Date, "now").mockReturnValue(now);
	const caller = new AbortController(),
		budget = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(budget.signal);
	const test = fixture(3_000_000_000);
	const outcome = test.call(caller.signal).catch((error) => error);
	await delay(10);
	(owner === "caller" ? caller : budget).abort();
	await expect(outcome).resolves.toMatchObject({ diagnostic: { reason: "aborted" } });
	expect(timeout).toHaveBeenCalledExactlyOnceWith(15_000);
	expect(test.sends()).toBe(1);
});

it("revalidates expiration after the wait instead of accepting a stale response", async () => {
	let clock = now;
	vi.spyOn(Date, "now").mockImplementation(() => clock);
	const test = fixture(2, (response) => ({ ...response, expiresAt: now + 3 }));
	const outcome = test.call().catch((error) => error);
	await delay(10);
	clock = now + 3;
	await expect(outcome).resolves.toMatchObject({ diagnostic: { verification: "expired" } });
	expect(test.sends()).toBe(1);
});

it("keeps the received envelope snapshot while waiting", async () => {
	let clock = now;
	vi.spyOn(Date, "now").mockImplementation(() => clock);
	const test = fixture(2);
	const result = test.call();
	await delay(10);
	const received = test.received();
	if (!received) throw new Error("No response received");
	received.signatureBase64 = Buffer.alloc(64).toString("base64");
	clock = now + 2;
	await expect(result).resolves.toEqual({ verified: true });
	expect(test.sends()).toBe(1);
});

it("does not query another route after the received response exhausts its clock-wait budget", async () => {
	vi.spyOn(Date, "now").mockReturnValue(now);
	const budget = new AbortController();
	vi.spyOn(AbortSignal, "timeout").mockReturnValue(budget.signal);
	const test = fixture(30_000);
	const direct = test.device.routes[0];
	if (!direct) throw new Error("No route");
	test.device.routes = [direct, { ...direct, kind: "card" }];
	const outcome = rpc(test.device, "device.describe", {}, new AbortController().signal).catch((error) => error);
	await delay(10);
	budget.abort();
	await expect(outcome).resolves.toMatchObject({ diagnostic: { reason: "aborted" } });
	expect(test.sends()).toBe(1);
});
