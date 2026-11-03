#!/usr/bin/env node
import { createHash, createPublicKey, X509Certificate } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attestationKey, type Grant, publicKeyId } from "@yonder/protocol";
import type { BackendProvider } from "./backend-provider.js";
import { type CardConnectionConfig, CardDaemonConnection } from "./card-connection.js";
import { DeviceExecutor } from "./executor.js";
import { CardInboxConnection, type InboxConnectionConfig } from "./inbox-connection.js";
import {
	ControllerPairing,
	type DirectRoute,
	ExecutorStore,
	type PairConfirmation,
	type PairingPolicy,
	type PairOffer,
	type PairProof,
} from "./store.js";

const required = (options: Record<string, string>, key: string): string => {
	const value = options[key];
	if (!value) throw new Error(`INVALID_REQUEST: --${key} required`);
	return value;
};
const input = <T>(): T => JSON.parse(readFileSync(0, "utf8")) as T;
const output = (value: unknown): void => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};
/** Derived from the same device token the inbox authenticates with. */
const inboxKey = (connection: InboxConnectionConfig): Buffer =>
	attestationKey(readFileSync(connection.tokenFile, "utf8").trim());
/** The executor self-reports the same key it signs responses with. */
const executorPublicKey = (executor: DeviceExecutor): string =>
	createPublicKey(executor.store.key).export({ format: "der", type: "spki" }).toString("base64");
const certificateFingerprint = (path: string): string =>
	createHash("sha256")
		.update(new X509Certificate(readFileSync(path)).raw)
		.digest("hex");

/** Management entry; no model, Agent workspace, shell command or implicit user home. */
export async function runCli(argv = process.argv.slice(2)): Promise<void> {
	const [group, ...tail] = argv;
	const operation = tail[0]?.startsWith("--") ? undefined : tail[0];
	const rest = operation ? tail.slice(1) : tail;
	const options: Record<string, string> = {};
	for (let i = 0; i < rest.length; i += 2) {
		const name = rest[i],
			value = rest[i + 1];
		if (!name?.startsWith("--") || !value || value.startsWith("--")) throw new Error("INVALID_REQUEST");
		options[name.slice(2)] = value;
	}
	const home = required(options, "home");
	if (group === "pair" && operation === "connect") {
		const controller = new ControllerPairing(home);
		if (options.phase === "prepare") {
			const request = input<{ offer: PairOffer; code: string; deviceFingerprint: string; tlsFingerprint?: string }>();
			output(controller.prove(request.offer, request.code, request.deviceFingerprint, request.tlsFingerprint));
			return;
		}
		if (options.phase === "finish") {
			const request = input<{ pairingId: string; confirmation: PairConfirmation; direct?: DirectRoute }>();
			if (!/^[a-f0-9-]{36}$/.test(request.pairingId)) throw new Error("INVALID_REQUEST");
			const offer = JSON.parse(readFileSync(resolve(home, `pending-${request.pairingId}.json`), "utf8")) as PairOffer;
			controller.finish(offer, request.confirmation, request.direct);
			output({ paired: true, deviceId: offer.deviceId });
			return;
		}
		throw new Error("INVALID_REQUEST");
	}
	if (group === "serve") {
		const providerModule = options.provider
			? pathToFileURL(resolve(options.provider)).href
			: new URL("./backends/linux-entry.js", import.meta.url).href;
		const loaded = (await import(providerModule)) as {
			createBackendProvider?: (options: { home: string }) => BackendProvider | Promise<BackendProvider>;
		};
		if (typeof loaded.createBackendProvider !== "function") throw new Error("UNSUPPORTED_OPERATION");
		const backend = await loaded.createBackendProvider({ home });
		if (!backend || typeof backend.describe !== "function" || !backend.actions) throw new Error("INVALID_REQUEST");
		const executor = new DeviceExecutor(home, backend, (diagnostic) => {
			process.stderr.write(`${JSON.stringify({ executionDiagnostic: diagnostic })}\n`);
		});
		const cards: CardDaemonConnection[] = [];
		const inboxes: CardInboxConnection[] = [];
		try {
			const host = options.host ?? "127.0.0.1";
			const port = options.port === undefined ? 0 : Number(options.port);
			if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("INVALID_REQUEST");
			const tls =
				options["tls-key"] && options["tls-cert"]
					? { key: readFileSync(options["tls-key"]), cert: readFileSync(options["tls-cert"]) }
					: undefined;
			const boundPort = await executor.listenDirect({ host, port, ...(tls ? { tls } : {}) });
			if (options["card-config"]) {
				const config = JSON.parse(readFileSync(options["card-config"], "utf8")) as
					| CardConnectionConfig
					| InboxConnectionConfig
					| Array<CardConnectionConfig | InboxConnectionConfig>;
				const connections = Array.isArray(config) ? config : [config];
				if (!connections.length) throw new Error("INVALID_REQUEST");
				for (const connection of connections) {
					// An entry without a peer is the inbox: the cloud introduces controllers to it.
					if (!("peerDeviceId" in connection)) {
						inboxes.push(
							new CardInboxConnection(
								connection,
								{
									introduce: (envelope, attestation, signal) => executor.introduce(envelope, attestation, signal),
									grants: () => executor.summaries(),
									revoke: (grantId) => executor.revokeGrant(grantId),
									allowance: (botId, devices) => executor.applyAllowance(botId, devices),
									registered: (identity) => executor.rememberCloud(identity, inboxKey(connection)),
									state: (state) => process.stderr.write(`${JSON.stringify({ inbox: state })}\n`),
									diagnostic: (message) => process.stderr.write(`${JSON.stringify({ inboxDiagnostic: message })}\n`),
								},
								executor.deviceId,
								executorPublicKey(executor),
							),
						);
						continue;
					}
					cards.push(
						new CardDaemonConnection(
							connection,
							(envelope, signal) => executor.handle(envelope, signal),
							(state) =>
								process.stderr.write(`${JSON.stringify({ card: state, peerDeviceId: connection.peerDeviceId })}\n`),
						),
					);
				}
				for (const card of cards) card.start();
				for (const inbox of inboxes) inbox.start();
			}
			output({
				deviceId: executor.deviceId,
				url: `${tls ? "https" : "http"}://${host}:${boundPort}/execution/v1`,
				...(tls ? { tlsFingerprint: certificateFingerprint(required(options, "tls-cert")) } : {}),
			});
			await new Promise<void>((done) => {
				process.once("SIGINT", () => done());
				process.once("SIGTERM", () => done());
			});
		} finally {
			for (const card of cards) card.close();
			for (const inbox of inboxes) inbox.close();
			await executor.close();
		}
		return;
	}
	const store = new ExecutorStore(home);
	try {
		if (group === "init") {
			output({ deviceId: store.data.deviceId, deviceFingerprint: publicKeyId(store.key) });
			return;
		}
		if (group === "pair" && operation === "start") {
			const fingerprint = options["tls-cert"] ? certificateFingerprint(options["tls-cert"]) : undefined;
			output(store.beginPairing(300_000, fingerprint));
			return;
		}
		if (group === "pair" && operation === "approve") {
			const request = input<{ proof: PairProof; code: string; grants: Grant[] }>();
			output(store.approvePairing(request.proof, request.code, request.grants));
			return;
		}
		if (group === "peers" && operation === "list") {
			output(Object.keys(store.data.peers));
			return;
		}
		if (group === "grants" && operation === "list") {
			output(Object.values(store.data.grants));
			return;
		}
		if (group === "grants" && operation === "revoke") {
			store.revokeAny(required(options, "grant-id"));
			output({ revoked: true });
			return;
		}
		if (group === "pairing" && operation === "policy") {
			if (options.set !== undefined) store.setPolicy(options.set as PairingPolicy);
			output({ policy: store.pairingPolicy });
			return;
		}
		throw new Error("UNSUPPORTED_OPERATION");
	} finally {
		store.close();
	}
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	runCli().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : "INTERNAL_ERROR"}\n`);
		process.exitCode = 1;
	});
}
