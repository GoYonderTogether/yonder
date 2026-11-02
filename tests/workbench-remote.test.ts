import { execFileSync } from "node:child_process";
import { createHash, randomUUID, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { resolveProfile } from "@yonder/local-host/config/test-support";
import { initHome, openKernel } from "@yonder/local-host/kernel/index";
import { attachmentFromPath } from "@yonder/runtime-adapter/node/runtime/attachments";
import { openDatabase, openRuntimeStorage } from "@yonder/runtime-adapter/node/runtime/db";
import { Runtime } from "@yonder/runtime-adapter/node/runtime/index";
import type { Grant, PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector, tempHome } from "@yonder/sdk/testing";
import { afterEach, expect, test } from "vitest";
import { parse, stringify } from "yaml";

const load = (path: string) => import(pathToFileURL(resolve(path)).href);
const { createHostProvider } = await load("packages/device/src/backends/host.ts");
const { DeviceExecutor } = await load("packages/device/src/executor.ts");
const { ControllerPairing } = await load("packages/device/src/store.ts");
const { configuredRegistry } = await load("plugins/devices/src/connections.ts");
const { DeviceController, executeCapabilities } = await load("plugins/devices/src/controller.ts");
const { createDevicesPlugin } = await load("plugins/devices/src/index.ts");

import { processTool } from "@yonder/runtime-adapter/node/runtime/process";
import { createRemoteEnvironment } from "@yonder/runtime-adapter/node/runtime/remote-env";

const close: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const cleanup of close.splice(0).reverse()) await cleanup();
});
async function setup() {
	const home = await realpath(await mkdtemp(join(tmpdir(), "yonder-remote-env-")));
	close.push(() => rm(home, { recursive: true, force: true }));
	const pairingHome = join(home, "controller");
	const configs = [];
	const roots: string[] = [];
	for (let index = 0; index < 2; index++) {
		const root = join(home, `resource${index}`);
		await mkdir(root);
		roots.push(root);
		let executor: InstanceType<typeof DeviceExecutor>;
		const provider = createHostProvider(randomUUID(), "execution-only");
		executor = new DeviceExecutor(join(home, `device${index}`), provider);
		Object.assign(provider, createHostProvider(executor.deviceId, "execution-only"));
		close.push(() => executor.close());
		const cert = join(home, `cert${index}.pem`),
			key = join(home, `key${index}.pem`);
		const opensslConfig = join(home, `openssl${index}.cnf`);
		await writeFile(
			opensslConfig,
			"[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\n",
		);
		execFileSync(
			"openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-days",
				"1",
				"-config",
				opensslConfig,
				"-keyout",
				key,
				"-out",
				cert,
			],
			{ stdio: "ignore" },
		);
		const bytes = await readFile(cert),
			pin = createHash("sha256").update(new X509Certificate(bytes).raw).digest("hex");
		const port = await executor.listenDirect({
			host: "127.0.0.1",
			port: 0,
			tls: { key: await readFile(key), cert: bytes },
		});
		const direct = { url: `https://127.0.0.1:${port}/execution/v1`, tlsFingerprint: pin };
		const pairing = new ControllerPairing(pairingHome),
			offer = executor.store.beginPairing(300000, pin);
		const proof = pairing.prove(offer, offer.code, offer.deviceFingerprint, pin);
		const grant: Grant = {
			grantId: randomUUID(),
			deviceId: executor.deviceId,
			principalId: proof.controllerFingerprint,
			revision: 0,
			capabilities: [...executeCapabilities],
			targetIds: ["host:filesystem"],
			actions: Object.keys(provider.actions),
			readRoots: [home],
			writeRoots: [home],
			issuedAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 300000).toISOString(),
			revokedAt: null,
		};
		pairing.finish(offer, executor.store.approvePairing(proof, offer.code, [grant]), direct);
		configs.push({ deviceId: executor.deviceId, name: `Executor ${index}`, grants: [grant], direct });
	}
	const discovery = configuredRegistry({ pairingHome, devices: configs }, { get: async () => undefined });
	close.push(discovery.close);
	const data = join(home, "commands"),
		controller = new DeviceController(data, discovery.registry);
	const ctx: ToolContext = {
		agent: null,
		profile: "owner",
		session: "integration",
		capabilities: [...executeCapabilities],
		env: { id: "test", cwd: home } as ToolContext["env"],
		signal: AbortSignal.timeout(20000),
		resources: configs.map((device, i) => ({ deviceId: device.deviceId, paths: [roots[i]!] })),
	};
	const first = configs[0]!.deviceId,
		second = configs[1]!.deviceId;
	const environment = (deviceId = first, context = ctx) =>
		createRemoteEnvironment(deviceId, deviceId === first ? roots[0]! : roots[1]!, (action, args, chord) =>
			controller.operation(deviceId, randomUUID(), action, args, {
				...context,
				signal: chord.abortSignal ?? context.signal,
			}),
		);
	return { home, roots, first, second, controller, data, discovery, ctx, environment, pairingHome, configs };
}

test("two real TLS executors support native remote files/process and enforce selected resources", async () => {
	const { home, roots, first, second, controller, data, discovery, ctx, environment } = await setup();
	const a = environment(),
		b = environment(second),
		c = BACKGROUND_CONTEXT;
	getOrThrow(await a.writeFile("one.txt", "first\nsecond\n", c));
	getOrThrow(await b.writeFile("two.txt", "other device", c));
	expect(getOrThrow(await a.readTextFile("one.txt", c))).toBe("first\nsecond\n");
	expect(getOrThrow(await b.readTextFile("two.txt", c))).toBe("other device");
	const reader = getOrThrow(await a.openBinaryReader("one.txt", {}, c));
	expect(getOrThrow(await reader.scanLines({ startLine: 1 }, c)).newlines).toBe(2);
	const readonly = environment(first, { ...ctx, capabilities: ["read", "network"] });
	expect(getOrThrow(await readonly.readTextFile("one.txt", c))).toContain("first");
	expect((await readonly.writeFile("denied.txt", "no", c)).ok).toBe(false);
	expect((await readonly.exec("pwd", {}, c)).ok).toBe(false);
	await writeFile(join(home, "outside.txt"), "private");
	await symlink(join(home, "outside.txt"), join(roots[0]!, "escape"));
	expect((await a.readTextFile("escape", c)).ok).toBe(false);
	await expect(
		controller.operation(
			second,
			randomUUID(),
			"fs.read",
			{ path: join(roots[1]!, "two.txt") },
			{ ...ctx, signal: AbortSignal.timeout(20000), resources: [ctx.resources![0]!] },
		),
	).rejects.toThrow("grant");
	let output = "";
	expect(
		getOrThrow(
			await a.exec(
				[process.execPath, "-e", "process.stdout.write(process.cwd());process.exit(3)"],
				{
					onOutput: (text) => {
						output += text;
					},
				},
				c,
			),
		).exitCode,
	).toBe(3);
	expect(output).toBe(roots[0]);
	const bash = processTool(home, new Map());
	const bashResult = await bash.execute(
		{ command: "printf native-remote-bash" },
		{ env: a, output: () => {} } as never,
		c,
	);
	expect(JSON.stringify(bashResult)).toContain("native-remote-bash");
	const commandId = randomUUID(),
		args = { path: join(roots[0]!, "once.txt"), dataBase64: "eA==", append: true };
	await controller.operation(first, commandId, "fs.write", args, ctx);
	await new DeviceController(data, discovery.registry).operation(first, commandId, "fs.write", args, ctx);
	expect(await readFile(args.path, "utf8")).toBe("x");
}, 60000);

test("remote process cancellation confirms its subprocess stopped", async () => {
	const { environment, roots } = await setup();
	const abort = new AbortController(),
		late = join(roots[0]!, "late");
	const pending = environment().exec(
		[
			process.execPath,
			"-e",
			"setTimeout(()=>require('node:fs').writeFileSync(process.argv[1],'late'),2000);setInterval(()=>{},1000)",
			late,
		],
		{},
		withAbortSignal(abort.signal, BACKGROUND_CONTEXT),
	);
	await new Promise((resolve) => setTimeout(resolve, 300));
	abort.abort();
	expect((await pending).ok).toBe(false);
	await new Promise((resolve) => setTimeout(resolve, 2100));
	await expect(readFile(late)).rejects.toMatchObject({ code: "ENOENT" });
}, 60000);

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real Luna reads two selected TLS devices and an explicitly configured image attachment",
	async () => {
		const fixture = await setup();
		const { home, first, second, roots, ctx, controller } = fixture;
		await writeFile(join(roots[0]!, "package.json"), await readFile(resolve("package.json")));
		await writeFile(join(roots[1]!, "package.json"), await readFile(resolve("packages/device/package.json")));
		const { api, registrations } = createRegistrationCollector();
		createDevicesPlugin(fixture.discovery.registry).setup({
			...api,
			paths: { data: join(home, "plugin") },
		} as unknown as PluginAPI);
		const db = await openDatabase(join(home, "runtime.db"));
		close.push(() => db.close());
		let session = "";
		const runtime = await Runtime.open({
			home,
			storage: await openRuntimeStorage(db),
			config: { schema: 1, credentials: auth },
			plugins: [{ id: "devices", tools: registrations.tools, hooks: [] }],
			deviceOperation: (config, deviceId, commandId, action, args, signal) =>
				controller.operation(deviceId, commandId, action, args, {
					...ctx,
					session,
					capabilities: [...config.resolved.capabilities, "network"],
					signal,
				}),
			resolveSession: async () => ({
				sessionId: session,
				sessionMode: "task",
				agent: null,
				profile: "integration",
				cwd: roots[0]!,
				resources: ctx.resources!,
				resolved: resolveProfile({
					level: "readonly",
					env: `device:${first}`,
					plugins: ["devices"],
					tools: { offer: ["read", "devices_list", "devices_operation"] },
					limits: { maxMinutes: 2 },
				}),
			}),
		});
		close.push(() => runtime.close());
		session = await runtime.create({ agent: null, profile: "integration", cwd: roots[0]! });
		const result = await runtime.submit(session, {
			text: `Read package.json on your default device using read. Then use devices_operation action fs.read with arguments {path:"${roots[1]}/package.json"}, deviceId ${second}, commandId a new UUID to read the second selected device. Report both actual package names. Do not run shell commands.`,
		});
		expect(result.status).toBe("done");
		expect(result.text).toContain("@yonder/device");
		expect(result.text).toContain("yonder");
		const transcript = await runtime.transcript(session);
		expect(transcript.flatMap((item) => item.tools ?? []).some((tool) => tool.name === "devices_operation")).toBe(true);
		const screenshot = process.env.YONDER_TEST_IMAGE;
		if (!screenshot) return;
		if (!existsSync(screenshot)) throw new Error("Actual user screenshot unavailable for attachment verification");
		const attachment = await attachmentFromPath(screenshot);
		const image = await runtime.submit(session, {
			text: "Inspect the attached actual interface screenshot and report the model name shown in its bottom bar. Do not use tools.",
			attachments: [attachment],
		});
		expect(image.status).toBe("done");
		expect(image.text.toLowerCase()).toContain("deepseek");
	},
	180000,
);

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real kernel owner Bot run loads selected remote project rules and executes default read/bash",
	async () => {
		const fixture = await setup(),
			home = await tempHome("ya-kr-");
		close.push(() => rm(home, { recursive: true, force: true }));
		await initHome(home, "owner", { model: "openai/gpt-6-luna" });
		const configPath = join(home, "yonder.yaml"),
			config = parse(await readFile(configPath, "utf8"));
		config.credentials = auth;
		config.plugins = [
			...(config.plugins ?? []).filter((plugin: { use: string }) => !plugin.use.endsWith("plugin-devices")),
			{ use: resolve("plugins/devices"), config: { pairingHome: fixture.pairingHome, devices: fixture.configs } },
		];
		await writeFile(configPath, stringify(config));
		const agentPath = join(home, "agents/main/agent.yaml"),
			agent = parse(await readFile(agentPath, "utf8"));
		agent.defaults.contexts.push("task-general");
		await writeFile(agentPath, stringify(agent));
		await writeFile(join(fixture.roots[0]!, "package.json"), await readFile(resolve("packages/device/package.json")));
		await writeFile(
			join(fixture.roots[0]!, "AGENTS.md"),
			"When reporting a completed task in this directory, include REMOTE_RULES_LOADED. This is the integration workspace's instruction.\n",
		);
		const kernel = await openKernel(home);
		close.push(() => kernel.close());
		const complete = async (event: string) => {
			let result: Record<string, unknown> | undefined;
			await expect
				.poll(
					async () => {
						const page = await kernel.events.query({ type: "run.end", limit: 100 });
						const found = page.events.find((item) => (item.data as { inputs?: string[] }).inputs?.includes(event));
						if (found) result = found.data;
						return !!found;
					},
					{ timeout: 120000, interval: 200 },
				)
				.toBe(true);
			return result!;
		};
		const first = await kernel.bots.send("main", "Reply READY without using tools.");
		await complete(first.event);
		await kernel.workbench.set(
			first.session,
			{ permission: "bypass", resources: [{ deviceId: fixture.first, paths: [fixture.roots[0]!] }] },
			new AbortController().signal,
		);
		const submitted = await kernel.bots.send(
			"main",
			"Read package.json with read, then execute bash command 'printf kernel-remote-ok' in your default execution workspace. Reply with the package name and command output, following the workspace instructions.",
		);
		const result = await complete(submitted.event);
		expect(result.status).toBe("done");
		const history = await kernel.sessions.transcript(first.session);
		const text = history.map((item) => item.text).join("\n");
		expect(text).toContain("@yonder/device");
		expect(text).toContain("kernel-remote-ok");
		expect(text).toContain("REMOTE_RULES_LOADED");
		expect(history.flatMap((item) => item.tools ?? []).some((tool) => tool.name === "bash")).toBe(true);
	},
	240000,
);
