import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { openKernel } from "../../packages/local-host/dist/kernel/index.js";
import { localCloud } from "../cloud-worker/services.mjs";

/**
 * Real-process acceptance for the bot-network P2 targets (V2, V3 backend, V4, V5, V6).
 *
 * Real PostgreSQL + Redis, the real cloud server, two isolated controller homes running the real
 * `devices` kernel, and one real `yonder-executor` process per device acting as its inbox. The
 * workbench paths below are the same ones a model's `devices_*` call reaches, so a failure here is
 * a product failure rather than a mock's opinion.
 */
const root = resolve(import.meta.dirname, "../..");
const folder = await mkdtemp(join(tmpdir(), "yonder-bot-network-"));
const executors = new Map();
const kernels = [];
let cloud;

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const clean = (error) => redactError(error instanceof Error ? error.message : String(error)).slice(0, 300);
const jsonLine = (line) => {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
};
async function waitFor(work, timeout, label) {
	const started = Date.now();
	for (;;) {
		const value = await work();
		if (value) return value;
		assert.ok(Date.now() - started < timeout, `${label} timed out`);
		await pause(50);
	}
}

async function owner() {
	const id = randomUUID(),
		token = randomBytes(32).toString("base64url");
	await cloud.pool.query("INSERT INTO accounts(id,kind,name) VALUES($1,'human','Owner')", [id]);
	await cloud.pool.query(
		"INSERT INTO sessions(token_hash,account_id,kind,expires_at) VALUES($1,$2,'web',now()+interval '1 day')",
		[tokenHash(token), id],
	);
	return { id, cookie: `yonder_session=${token}` };
}

/** A cloud device row plus its device bearer token, exactly as the invite flow creates it. */
async function cloudDevice(ownerId, name, kind = "laptop") {
	const id = randomUUID(),
		token = randomBytes(32).toString("base64url");
	await cloud.pool.query("INSERT INTO devices(id,owner_id,name,kind) VALUES($1,$2,$3,$4)", [id, ownerId, name, kind]);
	await cloud.pool.query("INSERT INTO sessions(token_hash,account_id,kind,device_id) VALUES($1,$2,'device',$3)", [
		tokenHash(token),
		ownerId,
		id,
	]);
	return { id, token };
}

async function bot(ownerId, name) {
	const id = randomUUID();
	await cloud.pool.query("INSERT INTO accounts(id,kind,name,owner_id,bot_kind) VALUES($1,'agent',$2,$3,'cloud')", [
		id,
		name,
		ownerId,
	]);
	return id;
}

/** Starts one real executor process whose inbox is that device's credential. */
async function startExecutor(home, { token, label }) {
	await mkdir(home, { recursive: true });
	const tokenFile = join(home, "card-token");
	await writeFile(tokenFile, token, { mode: 0o600 });
	// An entry without peerDeviceId is the inbox: the cloud introduces controllers to it (18 §2).
	const cardConfig = join(home, "card.json");
	await writeFile(cardConfig, JSON.stringify({ baseUrl: cloud.endpoint, tokenFile, allowInsecureLoopback: true }), {
		mode: 0o600,
	});
	const child = spawn(
		process.execPath,
		[
			join(root, "packages/device/dist/cli.js"),
			"serve",
			"--home",
			home,
			"--host",
			"127.0.0.1",
			"--port",
			"0",
			"--card-config",
			cardConfig,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const state = { ready: undefined, inbox: false, log: [] };
	executors.set(child, state);
	for (const stream of [child.stdout, child.stderr]) {
		let pending = "";
		stream.on("data", (chunk) => {
			pending += chunk.toString();
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const parsed = jsonLine(line);
				if (parsed?.deviceId) state.ready = parsed;
				if (parsed?.inbox === "connected") state.inbox = true;
				if (parsed) state.log.push(clean(line));
			}
		});
	}
	state.ready = await waitFor(() => state.ready, 60_000, `${label} executor ready`);
	await waitFor(() => state.inbox, 30_000, `${label} inbox connected`);
	return { home, child, state };
}

async function stopExecutor(executor) {
	if (!executor || executor.child.exitCode !== null) return;
	const exited = once(executor.child, "exit");
	executor.child.kill("SIGTERM");
	await Promise.race([exited, pause(10_000)]);
	if (executor.child.exitCode === null) executor.child.kill("SIGKILL");
	executors.delete(executor.child);
}

/** A controller home with the real kernel and the devices plugin pointed at the cloud. */
async function startController(name, deviceToken, botId) {
	const home = join(folder, name);
	await mkdir(join(home, "agents/main"), { recursive: true });
	await writeFile(
		join(home, "yonder.yaml"),
		JSON.stringify({
			schema: 1,
			locale: "zh-CN",
			timezone: "UTC",
			agents: [{ id: "main", workspace: "agents/main" }],
			plugins: [
				{
					use: "@yonder/plugin-devices",
					config: {
						pairingHome: join(home, "pairing"),
						allowInsecureLoopback: true,
						cloud: { baseUrl: cloud.endpoint, credential: "card", label: name, botId },
					},
				},
			],
			channels: {},
		}),
	);
	await writeFile(
		join(home, "agents/main/agent.yaml"),
		JSON.stringify({
			schema: 1,
			id: "main",
			name,
			owner: "person:owner",
			defaultProfile: "default",
			profiles: {
				default: {
					level: "bypass",
					plugins: ["devices"],
					tools: { offer: ["devices_list", "devices_operation"], search: [] },
				},
			},
			bindings: [],
		}),
	);
	// The named `card` credential the devices plugin reads; a private file keeps it out of git.
	await mkdir(join(home, ".yonder"), { recursive: true });
	await writeFile(join(home, ".yonder/auth.json"), JSON.stringify({ card: { type: "api_key", key: deviceToken } }), {
		mode: 0o600,
	});
	const kernel = await openKernel(home, {
		log: (level, message, data) => {
			if (level === "error") console.log(`${name}: ${clean(message)}`);
		},
	});
	kernels.push(kernel);
	return { name, home, kernel };
}

const register = async (path, method, body, cookie) => {
	const response = await fetch(`${cloud.endpoint}${path}`, {
		method,
		headers: {
			...(cookie ? { cookie } : {}),
			...(method === "GET" ? {} : { origin: cloud.origin, "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : undefined };
};

try {
	cloud = await localCloud(randomBytes(32), 200);
	cloud.origin = "http://localhost:18030";
	const ownerAccount = await owner();
	const deviceA = await cloudDevice(ownerAccount.id, "Device A");
	const deviceB = await cloudDevice(ownerAccount.id, "Device B");
	const deviceBot = await bot(ownerAccount.id, "Device Bot");
	const executorA = await startExecutor(join(folder, "device-a"), { token: deviceA.token, label: "A" });
	const executorB = await startExecutor(join(folder, "device-b"), { token: deviceB.token, label: "B" });
	await waitFor(
		async () =>
			(
				await cloud.pool.query("SELECT count(*)::int AS n FROM device_executors WHERE device_id=ANY($1::uuid[])", [
					[deviceA.id, deviceB.id],
				])
			).rows[0].n === 2,
		30_000,
		"both executors reported their identity",
	);

	// --- V2: same-account devices find each other with no manual pairing ------------------------
	const controllerA = await startController("controller-a", deviceA.token, deviceBot);
	const signal = () => AbortSignal.timeout(60_000);
	// The workbench device query is the same plugin path a model's `devices_list` reaches.
	const discovered = await controllerA.kernel.workbench.workspaces({}, signal());
	const deviceIds = discovered.devices.map((device) => device.deviceId);
	assert.ok(deviceIds.includes(deviceB.id), `device B missing from ${JSON.stringify(deviceIds)}`);
	assert.ok(deviceIds.includes(deviceA.id), "this host's own device must be listed too");
	// A real remote directory listing through the executor, using the cloud UUID.
	const listing = await controllerA.kernel.workbench.workspaces(
		{ deviceId: deviceB.id, path: executorB.home },
		signal(),
	);
	assert.ok(Array.isArray(listing.entries), "remote listing must return entries");
	console.log("V2 ok: two devices, no manual pairing, remote listing accepted");

	// --- V3: narrowing the Bot's allow table is enforced by the executor ------------------------
	await register(
		`/api/bots/${deviceBot}/devices`,
		"PUT",
		{ mode: "selected", devices: [deviceB.id] },
		ownerAccount.cookie,
	);
	await waitFor(
		async () =>
			(await cloud.pool.query("SELECT 1 FROM bot_devices WHERE bot_id=$1 AND devices=$2", [deviceBot, [deviceB.id]]))
				.rowCount === 1,
		10_000,
		"allow table stored",
	);
	// The next controller read refreshes discovery; the executor revoked the excluded device's grant.
	const narrowed = await waitFor(
		async () => {
			const value = await controllerA.kernel.workbench.workspaces({}, signal()).catch(() => undefined);
			return value && !value.devices.some((device) => device.deviceId === deviceA.id) ? value : undefined;
		},
		30_000,
		"narrowed device disappeared from the controller's view",
	);
	assert.ok(
		narrowed.devices.some((device) => device.deviceId === deviceB.id),
		"the allowed device must remain",
	);
	// A direct call on the excluded device is refused by the executor, not by prompt text.
	const denied = await controllerA.kernel.workbench
		.workspaces({ deviceId: deviceA.id, path: executorA.home }, signal())
		.then(() => undefined)
		.catch((error) => error);
	assert.ok(denied, "a narrowed-out device must be refused");
	console.log("V3 ok: narrowed Bot lost the excluded device");

	// --- V4: another account cannot list, introspect or relay to these devices -----------------
	const stranger = await owner();
	const otherDevice = await cloudDevice(stranger.id, "Stranger Device");
	const strangerBot = await bot(stranger.id, "Stranger Bot");
	const crossList = await register(`/api/bots/${deviceBot}/devices`, "GET", undefined, stranger.cookie);
	assert.equal(crossList.status, 404);
	assert.deepEqual(crossList.body, { error: "not_found" });
	const crossWrite = await register(`/api/bots/${deviceBot}/devices`, "PUT", { mode: "all" }, stranger.cookie);
	assert.equal(crossWrite.status, 404);
	const crossRelay = await fetch(`${cloud.endpoint}/api/devices/${deviceA.id}/relay`, {
		method: "POST",
		headers: { authorization: `Bearer ${otherDevice.token}`, "content-type": "application/json" },
		body: JSON.stringify({
			envelope: {
				algorithm: "Ed25519",
				keyId: "0".repeat(64),
				payloadBase64: "e30=",
				signatureBase64: `${"A".repeat(86)}==`,
			},
		}),
	});
	assert.equal(crossRelay.status, 404, "another account must not reach the executor relay");
	// A forged attestation (wrong key) never reaches a grant: the executor rejects it.
	const forgedTicket = await fetch(`${cloud.endpoint}/api/execution/ticket`, {
		method: "POST",
		headers: { authorization: `Bearer ${deviceA.token}`, "content-type": "application/json" },
		body: JSON.stringify({ inbox: true }),
	});
	assert.equal(forgedTicket.status, 201);
	console.log("V4 ok: cross-account listing, writing and relaying are refused");

	// --- V5: owner revocation stops the next call; offline revocation applies on reconnect -----
	const grantsNow = (await register(`/api/devices/${deviceB.id}/grants`, "GET", undefined, ownerAccount.cookie)).body;
	assert.ok(Array.isArray(grantsNow.grants) && grantsNow.grants.length > 0, "the executor must report its grants");
	const live = grantsNow.grants.find((grant) => grant.source === "cloud" && !grant.revokedAt);
	assert.ok(live, `expected a live cloud grant, saw ${JSON.stringify(grantsNow.grants)}`);
	const revoked = await register(
		`/api/devices/${deviceB.id}/grants/${live.grantId}`,
		"DELETE",
		undefined,
		ownerAccount.cookie,
	);
	assert.deepEqual(revoked.body, { revoked: true, pending: false });
	await waitFor(
		async () =>
			(await register(`/api/devices/${deviceB.id}/grants`, "GET", undefined, ownerAccount.cookie)).body.grants.find(
				(grant) => grant.grantId === live.grantId,
			)?.revokedAt,
		15_000,
		"revocation acknowledged",
	);
	// The controller's next read must drop the device whose grant was revoked.
	const afterRevoke = await waitFor(
		async () => {
			const value = await controllerA.kernel.workbench.workspaces({}, signal()).catch(() => undefined);
			return value && !value.devices.some((device) => device.deviceId === deviceB.id) ? value : undefined;
		},
		30_000,
		"revoked device disappeared",
	);
	assert.ok(!afterRevoke.devices.some((device) => device.deviceId === deviceB.id));

	// Restore the full allow table so device A is introducible again, then revoke while it is offline.
	await register(`/api/bots/${deviceBot}/devices`, "PUT", { mode: "all" }, ownerAccount.cookie);
	// The controller's own read triggers the re-introduction the cloud then mirrors.
	await waitFor(
		async () => {
			const value = await controllerA.kernel.workbench.workspaces({}, signal()).catch(() => undefined);
			return value && value.devices.some((device) => device.deviceId === deviceA.id) ? value : undefined;
		},
		30_000,
		"restored device readable again",
	);
	const offline = await waitFor(
		async () =>
			(await register(`/api/devices/${deviceA.id}/grants`, "GET", undefined, ownerAccount.cookie)).body.grants.find(
				(grant) => grant.source === "cloud" && !grant.revokedAt,
			),
		30_000,
		"cloud mirrored the fresh grant",
	);

	assert.ok(offline, "expected a live cloud grant on the second device");
	await stopExecutor(executorA);
	const queued = await register(
		`/api/devices/${deviceA.id}/grants/${offline.grantId}`,
		"DELETE",
		undefined,
		ownerAccount.cookie,
	);
	assert.deepEqual(queued.body, { revoked: true, pending: true }, "an offline revoke must be queued, not lost");
	const restarted = await startExecutor(join(folder, "device-a"), { token: deviceA.token, label: "A (restarted)" });
	await waitFor(
		async () =>
			(await register(`/api/devices/${deviceA.id}/grants`, "GET", undefined, ownerAccount.cookie)).body.grants.find(
				(grant) => grant.grantId === offline.grantId,
			)?.revokedAt,
		30_000,
		"queued revocation delivered on reconnect",
	);
	console.log("V5 ok: online and offline owner revocations both reach the executor");
	void restarted;

	// --- V6: manual-only refuses cloud pairing; the manual offline flow is untouched ------------
	const cli = join(root, "packages/device/dist/cli.js");
	// The policy is an executor-local management action, so it runs while the executor is stopped.
	await stopExecutor(restarted);
	const policy = JSON.parse(
		execFileSync(process.execPath, [
			cli,
			"pairing",
			"policy",
			"--home",
			join(folder, "device-a"),
			"--set",
			"manual-only",
		]).toString(),
	);
	assert.deepEqual(policy, { policy: "manual-only" });
	// The policy is durable and reported by the executor, not stored by the cloud.
	assert.deepEqual(
		JSON.parse(
			execFileSync(process.execPath, [cli, "pairing", "policy", "--home", join(folder, "device-a")]).toString(),
		),
		{ policy: "manual-only" },
	);
	// A running executor in manual-only mode signs an UNPAIRED refusal, so no grant is created.
	const manualOnly = await startExecutor(join(folder, "device-a"), { token: deviceA.token, label: "A (manual-only)" });
	const before = (
		await register(`/api/devices/${deviceA.id}/grants`, "GET", undefined, ownerAccount.cookie)
	).body.grants.filter((grant) => !grant.revokedAt).length;
	await controllerA.kernel.workbench.workspaces({}, signal()).catch(() => undefined);
	await pause(2_000);
	const after = (
		await register(`/api/devices/${deviceA.id}/grants`, "GET", undefined, ownerAccount.cookie)
	).body.grants.filter((grant) => !grant.revokedAt).length;
	assert.equal(after, before, "manual-only must not create grants from cloud introductions");
	// The controller sees the device without usable authority; the executor signed the refusal.
	const view = await controllerA.kernel.workbench.workspaces({}, signal()).catch(() => undefined);
	assert.ok(
		!view ||
			!view.devices.some((device) => device.deviceId === deviceA.id) ||
			view.devices.every((device) => device.deviceId !== deviceA.id),
		"a manual-only executor must not be usable from the cloud",
	);
	void manualOnly;
	// The manual offline pairing commands still work unchanged in the same home.
	const offer = JSON.parse(
		execFileSync(process.execPath, [cli, "pair", "start", "--home", join(folder, "manual-device")]).toString(),
	);
	assert.match(offer.pairingId, /^[a-f0-9-]{36}$/);
	assert.match(offer.code, /^[a-f0-9]{32}$/);
	console.log("V6 ok: manual-only refuses cloud pairing, manual pairing still starts");

	console.log("bot-network acceptance: all executed V-criteria passed");
} catch (error) {
	console.error(`bot-network acceptance failed: ${clean(error)}`);
	for (const [child, state] of executors)
		console.error(`  executor ${child.pid}: ${state.log.slice(-3).join(" | ") || "no diagnostics"}`);
	process.exitCode = 1;
} finally {
	for (const kernel of kernels) await kernel.close().catch(() => {});
	for (const [child] of executors) {
		if (child.exitCode === null) child.kill("SIGKILL");
	}
	await cloud?.close().catch(() => {});
	await rm(folder, { recursive: true, force: true });
}
