#!/usr/bin/env node
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Grant, publicKeyId } from "@yonder/execution-protocol";
import type { BackendProvider } from "./backend-provider.js";
import { DeviceExecutor } from "./executor.js";
import {
	ControllerPairing,
	type DirectRoute,
	ExecutorStore,
	type PairConfirmation,
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
		const providerModule = pathToFileURL(resolve(required(options, "provider"))).href;
		const loaded = (await import(providerModule)) as {
			createBackendProvider?: (options: { home: string }) => BackendProvider | Promise<BackendProvider>;
		};
		if (typeof loaded.createBackendProvider !== "function") throw new Error("UNSUPPORTED_OPERATION");
		const backend = await loaded.createBackendProvider({ home });
		if (!backend || typeof backend.describe !== "function" || !backend.actions) throw new Error("INVALID_REQUEST");
		const executor = new DeviceExecutor(home, backend);
		try {
			const host = options.host ?? "127.0.0.1";
			const port = options.port === undefined ? 0 : Number(options.port);
			if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("INVALID_REQUEST");
			const tls =
				options["tls-key"] && options["tls-cert"]
					? { key: readFileSync(options["tls-key"]), cert: readFileSync(options["tls-cert"]) }
					: undefined;
			const boundPort = await executor.listenDirect({ host, port, ...(tls ? { tls } : {}) });
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
			const grantId = required(options, "grant-id");
			const grant = store.data.grants[grantId];
			if (!grant) throw new Error("COMMAND_NOT_FOUND");
			store.revoke(grant.principalId, grantId);
			output({ revoked: true });
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
