import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";

/**
 * Bot-network P6: one user-facing loop through real processes on this machine.
 *
 *   temp PostgreSQL 17 + Redis 8  →  the real yonder-cloud server  →  the built web app
 *   (apps/app, served by `vite preview` with the cloud as its proxied social backend)
 *   ── Account A signs in through the real login page ──
 *   the built `yonder-connect dsh` installer  →  the real `/connect?code=` page confirms it
 *   →  DSH boots the packed connector against the user's configured DeepSeek model
 *   →  a real `yonder-executor` binds the same account as a second device
 *   →  a real Yonder agent host is the device whose catalogue carries `devices_*`
 *   →  the cloud Bot (real glm-5.3-flash) reads and writes a file on the executor and reads it back
 *   →  the owner narrows that Bot in the web UI and the next call has no device tools.
 *
 * Every model turn is a real model call. A missing credential records 未测 for that step instead
 * of passing it. Nothing is mocked: the browser is a headless Chrome driven over CDP, the phone
 * line is not touched, and the user's own DSH profiles/sessions/storages are never opened.
 *
 * Run: node scripts/bot-network/e2e.mjs [--keep] [--step=list]
 *   YONDER_CLOUD_CHECKOUT  cloud worktree (default ../yonder-cloud-bot-network)
 *   P6_PORT_BASE           first port to use (default 47600; steps claim 47600..47620)
 */

const root = resolve(import.meta.dirname, "../..");
const cloudCheckout = resolve(process.env.YONDER_CLOUD_CHECKOUT ?? join(root, "../yonder-cloud-bot-network"));
const keep = process.argv.includes("--keep");
const deepseekAuth = "/Users/zoran/Documents/yonder/.yonder/auth.json";
const botModelKey = join(process.env.HOME ?? "", ".config/yonder/cloud-bot-model.key");

const stepRows = [];
const untested = [];
/** Every process this run starts, with its recent output, so `finally` can stop all of them. */
const children = new Map();
let folder;
let cloud;
let dshHome;
let execHome;
let agentHome;
let browserHome;

const clean = (error) => redactError(error instanceof Error ? error.message : String(error)).slice(0, 300);

function record(name, result, detail) {
	stepRows.push({
		name,
		result,
		detail: String(detail ?? "")
			.replace(/\s+/g, " ")
			.slice(0, 200),
	});
	console.log(
		`${result === "通过" ? "PASS" : result === "未测" ? "SKIP" : "FAIL"} ${name} — ${String(detail ?? "").slice(0, 300)}`,
	);
	if (result === "未测") untested.push(`${name}：${detail}`);
}

async function run(name, work) {
	try {
		const detail = await work();
		record(name, "通过", detail ?? "");
	} catch (error) {
		record(name, "失败", clean(error));
		throw error;
	}
}

function skip(name, reason) {
	record(name, "未测", reason);
}

async function waitFor(work, timeout, label) {
	const started = Date.now();
	for (;;) {
		const value = await work();
		if (value) return value;
		assert.ok(Date.now() - started < timeout, `${label} timed out after ${timeout}ms`);
		await pause(100);
	}
}

const freePort = () =>
	new Promise((ok, ko) => {
		const server = spawn(
			process.execPath,
			[
				"-e",
				'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})',
			],
			{
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		let out = "";
		server.stdout.on("data", (chunk) => (out += chunk));
		server.once("exit", () => ok(Number(out.trim())));
		server.once("error", ko);
	});

function track(child, label) {
	children.set(child, { label, log: [] });
	for (const stream of [child.stdout, child.stderr]) {
		let pending = "";
		stream?.on("data", (chunk) => {
			pending += chunk.toString();
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				const log = children.get(child)?.log;
				log?.push(clean(line));
				if (log && log.length > 60) log.shift();
			}
		});
	}
	return child;
}

function tail(child) {
	return children.get(child)?.log?.slice(-3).join(" | ") ?? "no diagnostics";
}

async function stop(child) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, "exit");
	child.kill("SIGTERM");
	const closed = await Promise.race([exited.then(() => true), pause(8_000).then(() => false)]);
	if (!closed) {
		child.kill("SIGKILL");
		await exited;
	}
	children.delete(child);
}

// --- services --------------------------------------------------------------------------------

async function startPostgresRedis(dir) {
	const pgBin = (name) => join(process.env.TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@17/bin", name);
	const redisBin = process.env.TEST_REDIS_SERVER ?? "/opt/homebrew/bin/redis-server";
	if (!existsSync(pgBin("initdb"))) throw new Error(`PostgreSQL 17 not found at ${pgBin("initdb")}`);
	if (!existsSync(redisBin)) throw new Error(`Redis not found at ${redisBin}`);
	const pgPort = await freePort();
	const redisPort = await freePort();
	const env = { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" };
	const run = (name, args) => execFileSync(name, args, { stdio: "pipe", timeout: 120_000, env });
	run(pgBin("initdb"), ["-D", join(dir, "pg"), "-U", "test", "-A", "trust", "--no-locale", "-E", "UTF8"]);
	run(pgBin("pg_ctl"), [
		"-D",
		join(dir, "pg"),
		"-l",
		join(dir, "postgres.log"),
		"-o",
		`-h 127.0.0.1 -p ${pgPort} -k ''`,
		"-w",
		"start",
	]);
	const redis = track(
		spawn(
			redisBin,
			["--bind", "127.0.0.1", "--port", String(redisPort), "--save", "", "--appendonly", "no", "--dir", dir],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env,
			},
		),
		"redis",
	);
	const databaseUrl = `postgres://test@127.0.0.1:${pgPort}/postgres`;
	const redisUrl = `redis://127.0.0.1:${redisPort}`;
	return {
		databaseUrl,
		redisUrl,
		async close() {
			await stop(redis);
			run(pgBin("pg_ctl"), ["-D", join(dir, "pg"), "-m", "immediate", "-w", "stop"]);
		},
	};
}

/** The real cloud server from its worktree, on a loopback origin with the dev fixed-code login. */
async function startCloud({ databaseUrl, redisUrl, port, workerKeyFile }) {
	// `index.js` only serves: the schema comes from the repo's own migration entry (as the deploy does).
	execFileSync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
		cwd: join(cloudCheckout, "server"),
		env: { ...process.env, DATABASE_URL: databaseUrl },
		stdio: "pipe",
		timeout: 180_000,
	});
	const child = track(
		spawn(process.execPath, [join(cloudCheckout, "server/dist/server/src/index.js")], {
			cwd: cloudCheckout,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
				REDIS_URL: redisUrl,
				PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
				PORT: String(port),
				// Fixed-code login is the intended dev path (G-05 方案 B); no SMS/email provider is configured.
				E2E_FIXED_CODE: "135790",
				E2E_FIXED_CODE_IDENTITIES: "e2e@yonder.test",
				CLOUD_BOT_WORKER_KEY_FILE: workerKeyFile,
			},
		}),
		"cloud",
	);
	const origin = `http://127.0.0.1:${port}`;
	await waitFor(
		async () => {
			try {
				return (await fetch(`${origin}/api/version`)).ok;
			} catch {
				return false;
			}
		},
		60_000,
		"cloud server ready",
	);
	return { origin, child };
}

/** The built web app served by vite preview, whose /api and /ws proxy to the local cloud. */
async function startWebApp(port, cloudOrigin) {
	const app = join(root, "apps/app");
	if (!existsSync(join(app, "dist/index.html")))
		throw new Error("apps/app/dist is missing; run: VITE_API=http YONDER_APP_BASE=/ npm run build -w @yonder/app");
	const viteConfig = JSON.parse(readFileSync(join(root, "node_modules/vite/package.json"), "utf8"));
	assert.ok(viteConfig.version, "vite package is present");
	const child = track(
		spawn(
			process.execPath,
			[
				join(root, "node_modules/vite/bin/vite.js"),
				"preview",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
				"--strictPort",
			],
			{
				cwd: app,
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, YONDER_SOCIAL: cloudOrigin },
			},
		),
		"web",
	);
	const origin = `http://127.0.0.1:${port}`;
	await waitFor(
		async () => {
			try {
				return (await fetch(origin)).ok;
			} catch {
				return false;
			}
		},
		60_000,
		"web app ready",
	);
	return { origin, child };
}

/** The cloud Bot worker: one process, the real platform model, the real shared core. */
async function startWorker({ databaseUrl, cloudOrigin, workerKeyFile, modelKeyFile }) {
	const child = track(
		spawn(process.execPath, [join(root, "scripts/cloud-worker/process.mjs")], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
				YONDER_CLOUD_ENDPOINT: cloudOrigin,
				CLOUD_BOT_WORKER_KEY_FILE: workerKeyFile,
				CLOUD_BOT_MODEL_KEY_FILE: modelKeyFile,
			},
		}),
		"worker",
	);
	await waitFor(async () => children.get(child)?.log?.length !== undefined, 30_000, "worker spawned");
	await pause(6_000);
	assert.equal(child.exitCode, null, `worker exited: ${tail(child)}`);
	return child;
}

function startExecutor(home, cardConfig) {
	const child = track(
		spawn(
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
			{
				stdio: ["ignore", "pipe", "pipe"],
			},
		),
		"executor",
	);
	return child;
}

function startAgentHost(home) {
	const child = track(
		spawn(process.execPath, [join(root, "packages/cli/dist/index.js"), "start", "--home", home, "--json"], {
			stdio: ["ignore", "pipe", "pipe"],
		}),
		"agent-host",
	);
	return child;
}

// --- http helpers ----------------------------------------------------------------------------

function client(origin, cookie) {
	return async (path, method = "GET", body) => {
		const response = await fetch(`${origin}${path}`, {
			method,
			headers: {
				origin,
				...(cookie ? { cookie } : {}),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		let json;
		try {
			json = text ? JSON.parse(text) : undefined;
		} catch {
			json = text;
		}
		return { status: response.status, json, headers: response.headers };
	};
}

// --- browser ---------------------------------------------------------------------------------

/** Headless Chrome over CDP with an isolated profile; never the user's browser or screen. */
async function openBrowser() {
	const chromeCandidates = [
		process.env.CHROME_PATH,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
	]
		.filter(Boolean)
		.filter((path) => existsSync(path));
	if (!chromeCandidates.length) throw new Error("No Chrome/Chromium found; set CHROME_PATH");
	const port = await freePort();
	const profile = join(folder, "chrome-profile");
	const child = track(
		spawn(
			chromeCandidates[0],
			[
				"--headless=new",
				`--remote-debugging-port=${port}`,
				`--user-data-dir=${profile}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--disable-gpu",
				"--hide-scrollbars",
				"about:blank",
			],
			{ stdio: "ignore" },
		),
		"chrome",
	);
	const target = await waitFor(
		async () => {
			try {
				const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
				return targets.find((entry) => entry.type === "page");
			} catch {
				return undefined;
			}
		},
		30_000,
		"Chrome devtools",
	);
	const page = createCdp(target.webSocketDebuggerUrl);
	await page.ready;
	await page.send("Page.enable");
	await page.send("Runtime.enable");
	await page.send("Network.enable");
	return { child, page };
}

function createCdp(url) {
	const ws = new WebSocket(url);
	let seq = 0;
	const pending = new Map();
	const waiters = new Map();
	ws.onmessage = (event) => {
		let message;
		try {
			message = JSON.parse(event.data);
		} catch {
			return;
		}
		if (message.id && pending.has(message.id)) {
			const { resolve: ok, reject: ko } = pending.get(message.id);
			pending.delete(message.id);
			message.error ? ko(new Error(message.error.message)) : ok(message.result);
		} else if (message.method && waiters.has(message.method)) {
			for (const fn of waiters.get(message.method)) fn(message.params);
			waiters.delete(message.method);
		}
	};
	const page = {
		ws,
		ready: new Promise((ok, ko) => {
			ws.onopen = ok;
			ws.onerror = () => ko(new Error("CDP connect failed"));
		}),
		send: (method, params = {}) =>
			new Promise((ok, ko) => {
				const id = ++seq;
				pending.set(id, { resolve: ok, reject: ko });
				ws.send(JSON.stringify({ id, method, params }));
			}),
		once: (method, ms) =>
			new Promise((ok, ko) => {
				const timer = setTimeout(() => ko(new Error(`CDP ${method} timed out`)), ms);
				const list = waiters.get(method) ?? [];
				list.push((params) => {
					clearTimeout(timer);
					ok(params);
				});
				waiters.set(method, list);
			}),
		async goto(url) {
			const loaded = page.once("Page.loadEventFired", 30_000);
			const result = await page.send("Page.navigate", { url });
			if (result.errorText) throw new Error(`navigate ${url}: ${result.errorText}`);
			await loaded;
			await pause(400);
		},
		/** Evaluate an expression in the page and return its JSON value; a thrown error surfaces here. */
		async eval(expression) {
			const result = await page.send("Runtime.evaluate", {
				expression,
				awaitPromise: true,
				returnByValue: true,
				userGesture: true,
			});
			if (result.exceptionDetails) {
				const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
				throw new Error(String(detail).split("\n").slice(0, 3).join(" "));
			}
			return result.result.value;
		},
		async waitForText(text, ms = 30_000) {
			await waitFor(
				async () =>
					await page.eval(`document.body ? document.body.innerText.includes(${JSON.stringify(text)}) : false`),
				ms,
				`text "${text}"`,
			);
		},
		async waitFor(expression, ms = 30_000, label = expression) {
			await waitFor(() => page.eval(expression), ms, label);
		},
		close() {
			ws.close();
		},
	};
	return page;
}

/**
 * The login form uses React `useId` ids, no names and no testids (docs: apps/app Field). Select by
 * visible label text, the same way a person reads the page.
 */
const clickByText = (text, tag = "button") => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find((node) => node.innerText && node.innerText.trim() === ${JSON.stringify(text)});
  if (!el) throw new Error("no element labelled " + ${JSON.stringify(text)});
  el.click(); return true;
})()`;
const fillByLabel = (label, value) => `(() => {
  const field = [...document.querySelectorAll("label")].find((node) => node.innerText && node.innerText.trim() === ${JSON.stringify(label)});
  const input = field && field.parentElement && field.parentElement.querySelector("input,textarea");
  if (!input) throw new Error("no field labelled " + ${JSON.stringify(label)});
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`;

/** Real login through the page: 验证码登录 → 邮箱 → 固定验证码 (the cloud's E2E_FIXED_CODE). */
async function signIn(page, webOrigin) {
	await page.goto(`${webOrigin}/`);
	await page.waitForText("登录");
	await page.eval(clickByText("验证码登录 / 忘记密码"));
	await page.eval(clickByText("邮箱", '[role="tab"]'));
	await page.eval(fillByLabel("邮箱", "e2e@yonder.test"));
	await pause(200);
	await page.eval(clickByText("发送验证码"));
	try {
		await page.waitForText("验证码已发送", 30_000);
	} catch (error) {
		throw new Error(
			`${clean(error)}; page: ${(await page.eval("document.body.innerText")).replace(/\s+/g, " ").slice(0, 300)}`,
		);
	}
	await page.eval(fillByLabel("验证码", "135790"));
	await page.eval(clickByText("登录 / 注册"));
	await page.waitFor(`!location.pathname.startsWith("/login")`, 30_000, "signed in");
}

// --- steps -----------------------------------------------------------------------------------

const state = {};

try {
	folder = mkdtempSync(join(tmpdir(), "p6-e2e-"));
	const portBase = Number(process.env.P6_PORT_BASE ?? 47600);
	const cloudPort = portBase;
	const webPort = portBase + 1;

	await run("准备隔离目录与凭据", async () => {
		dshHome = join(folder, "p6-dsh");
		execHome = join(folder, "p6-exec");
		agentHome = join(folder, "p6-agent");
		browserHome = join(folder, "p6-browser");
		mkdirSync(dshHome, { recursive: true });
		mkdirSync(execHome, { recursive: true, mode: 0o700 });
		mkdirSync(browserHome, { recursive: true });
		const workerKey = join(folder, "worker.key");
		execFileSync(process.execPath, [
			"-e",
			`require("fs").writeFileSync(${JSON.stringify(workerKey)}, require("crypto").randomBytes(32), { mode: 0o600 })`,
		]);
		state.workerKey = workerKey;
		state.hasDeepSeek = existsSync(deepseekAuth);
		state.hasCloudModel = existsSync(botModelKey);
		return `PG/Redis temp dir, worker key 0600, DSH 密钥 ${state.hasDeepSeek ? "在" : "缺"}, 云端模型密钥 ${state.hasCloudModel ? "在" : "缺"}`;
	});

	await run("启动临时 PostgreSQL 17 与 Redis 8", async () => {
		state.services = await startPostgresRedis(folder);
		return "initdb + pg_ctl + redis-server（仅回环）";
	});

	await run("迁移并启动真实云端 server", async () => {
		state.cloud = await startCloud({
			databaseUrl: state.services.databaseUrl,
			redisUrl: state.services.redisUrl,
			port: cloudPort,
			workerKeyFile: state.workerKey,
		});
		return state.cloud.origin;
	});

	await run("启动构建好的网页（apps/app + vite preview → 云端）", async () => {
		state.web = await startWebApp(webPort, state.cloud.origin);
		return `${state.web.origin} → ${state.cloud.origin}`;
	});

	state.browser = await openBrowser();
	const page = state.browser.page;

	await run("账号 A 经真实登录页登录", async () => {
		await signIn(page, state.web.origin);
		// The session cookie is HttpOnly by design, so read it from the browser's cookie jar rather than JS.
		const jar = await page.send("Network.getAllCookies");
		const cookie = jar.cookies.find((entry) => entry.name === "yonder_session");
		state.cookie = cookie ? `yonder_session=${cookie.value}` : undefined;
		assert.ok(state.cookie, "no web session cookie after login");
		state.account = client(state.cloud.origin, state.cookie);
		const session = await state.account("/api/session");
		assert.equal(session.status, 200);
		return `actor ${session.json?.actor?.id}`;
	});

	// --- DSH: real installer, real confirmation page -------------------------------------------------
	await run("DSH 隔离 home 与 profile", async () => {
		const launcher = execFileSync("sh", ["-c", "command -v dsh"], { encoding: "utf8" }).trim();
		assert.ok(launcher, "dsh not on PATH");
		state.dsh = launcher;
		execFileSync(launcher, ["--profile", "p6", "--from-default-profile", "web", "--dump-config"], {
			env: { ...process.env, DSH_HOME: dshHome },
			stdio: "ignore",
			timeout: 120_000,
		});
		assert.ok(existsSync(join(dshHome, "profiles/p6/package.json")), "profile p6 not created");
		state.dshSnapshot = snapshotTree(dshHome);
		return `${launcher} → ${dshHome}/profiles/p6`;
	});

	await run("本地打包 @yonder/dsh-connector（未发布 npm，用本地 tarball）", async () => {
		const out = join(folder, "artifacts");
		mkdirSync(out, { recursive: true });
		const packed = execFileSync("npm", ["pack", "--pack-destination", out], {
			cwd: join(root, "connectors/dsh"),
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.at(-1);
		state.tarball = join(out, packed);
		assert.ok(existsSync(state.tarball), `no tarball at ${state.tarball}`);
		return packed;
	});

	await run("真实安装器 yonder-connect dsh（built packages/connect）", async () => {
		const child = track(
			spawn(
				process.execPath,
				[
					join(root, "packages/connect/dist/cli.js"),
					"dsh",
					"--spec",
					state.tarball,
					"--no-open",
					"--interval-ms",
					"500",
				],
				{
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, DSH_HOME: dshHome, YONDER_ENDPOINT: state.cloud.origin },
				},
			),
			"connect",
		);
		state.connect = child;
		const url = await waitFor(
			() => /\/connect\?code=([A-Za-z0-9_-]+)/.exec(children.get(child)?.log?.join("\n") ?? "")?.[0],
			180_000,
			"installer pairing url",
		);
		state.pairingUrl = new URL(url, state.cloud.origin).href;
		return `配对链接 ${state.pairingUrl.replace(/code=.*/, "code=…")}`;
	});

	await run("在真实网页里确认 /connect?code=…（人类那一步）", async () => {
		// The device code page is the web app's /connect route; in dev the app is served from its own
		// origin (vite preview) while the cloud only issues the code, so keep the path and swap the origin.
		const confirmation = new URL(state.pairingUrl);
		await page.goto(`${state.web.origin}${confirmation.pathname}${confirmation.search}`);
		await page.waitForText("连接设备", 30_000);
		const deviceName = await page.eval(
			`document.body.innerText.split("\\n").find((line) => line && line !== "连接设备" && line !== "允许连接" && line !== "P") ?? ""`,
		);
		await page.eval(clickByText("允许连接"));
		await page.waitForText("已连接", 30_000);
		state.harnessName = deviceName;
		return `页面显示设备名「${deviceName}」并点击允许连接`;
	});

	await run("安装器完成：设备令牌写入隔离 home（0600）", async () => {
		// `exitCode` stays null while running *and* after a signal kill; wait on a real settled value.
		const settled = () =>
			state.connect.exitCode !== null
				? state.connect.exitCode
				: state.connect.signalCode !== null
					? state.connect.signalCode
					: undefined;
		await waitFor(() => (settled() === undefined ? undefined : true), 240_000, "installer exit");
		const code = settled();
		assert.equal(
			code,
			0,
			`installer exit ${code}: ${(children.get(state.connect)?.log ?? []).join(" | ").slice(-600)}`,
		);
		const configPath = join(dshHome, "yonder/config.json");
		assert.ok(existsSync(configPath), "installer wrote no config");
		const mode = statSync(configPath).mode & 0o777;
		assert.equal(mode, 0o600, `token file mode ${mode.toString(8)}`);
		state.harnessToken = JSON.parse(readFileSync(configPath, "utf8")).deviceToken;
		return `${configPath} mode 600`;
	});

	if (!state.hasDeepSeek) {
		skip("启动 DSH（真实 DeepSeek 模型）", "本机没有 ~/Documents/yonder/.yonder/auth.json 的 deepseek 凭据");
	} else {
		await run("启动 DSH（连接器 bundle + 用户已配置的 DeepSeek 模型）", async () => {
			// The key is passed as an env var only: never printed, never written to a file.
			const key = JSON.parse(readFileSync(deepseekAuth, "utf8"))?.deepseek?.key;
			assert.ok(typeof key === "string" && key, "deepseek key missing");
			const child = track(
				spawn(state.dsh, ["--profile", "p6", "--no-open", "--port", String(portBase + 10)], {
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, DSH_HOME: dshHome, DEEPSEEK_API_KEY: key },
				}),
				"dsh",
			);
			state.dshProcess = child;
			await waitFor(() => children.get(child)?.log?.some((line) => line.includes("dsh web:")), 180_000, "DSH web url");
			const device = await waitFor(
				async () =>
					(await state.account("/api/devices")).json?.find(
						(row) => row.kind === "harness" && row.online && row.workProtocol === 1,
					),
				120_000,
				"harness device online with workProtocol",
			);
			state.harnessDevice = device;
			assert.equal(device.name, state.harnessName, "the confirmed device name must be the one that came online");
			return `${device.name} online, workProtocol=1, ${device.id}`;
		});

		await run("DSH 的 Bot 登记在设备上", async () => {
			const agents = await state.account(`/api/devices/${state.harnessDevice.id}/agents`);
			assert.equal(agents.status, 200);
			assert.ok(Array.isArray(agents.json) && agents.json.length > 0, "no bots registered");
			state.harnessBots = agents.json;
			return agents.json.map((row) => row.actor.name).join("、");
		});
	}

	// --- second device: a real executor --------------------------------------------------------------
	await run("第二台设备：真实 yonder-executor 绑定同一账号（无手工配对）", async () => {
		const invite = await state.account("/api/device/invite", "POST", {});
		assert.equal(invite.status, 201);
		const redeem = await state.account("/api/device/redeem", "POST", {
			code: invite.json.code,
			name: "P6 Executor",
			kind: "laptop",
		});
		assert.equal(redeem.status, 200);
		const tokenFile = join(execHome, "card-token");
		const { writeFileSync } = await import("node:fs");
		writeFileSync(tokenFile, redeem.json.deviceToken, { mode: 0o600 });
		const cardConfig = join(execHome, "card.json");
		writeFileSync(cardConfig, JSON.stringify({ baseUrl: state.cloud.origin, tokenFile, allowInsecureLoopback: true }), {
			mode: 0o600,
		});
		state.executor = startExecutor(execHome, cardConfig);
		state.executorDevice = await waitFor(
			async () => {
				const list = (await state.account("/api/devices")).json ?? [];
				return list.find((row) => row.name === "P6 Executor" && row.executor);
			},
			60_000,
			"executor device registered",
		);
		return `${state.executorDevice.id}（执行端 ${state.executorDevice.executor.deviceId}）`;
	});

	// --- device C: a real Yonder agent host whose catalogue carries devices_* --------------------------
	await run("第三台设备：真实 Yonder agent host（devices 插件 + card 渠道）", async () => {
		const invite = await state.account("/api/device/invite", "POST", {});
		const agentDir = { home: agentHome };
		mkdirSync(join(agentDir.home, "agents/main"), { recursive: true });
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			join(agentDir.home, "yonder.yaml"),
			JSON.stringify({
				schema: 1,
				locale: "zh-CN",
				timezone: "UTC",
				agents: [{ id: "main", workspace: "agents/main" }],
				identity: { persons: [{ id: "owner", name: "P6 owner", accounts: [] }] },
				plugins: [
					{ use: "@yonder/plugin-channel-card" },
					{
						use: "@yonder/plugin-devices",
						config: {
							pairingHome: join(agentDir.home, "pairing"),
							allowInsecureLoopback: true,
							cloud: {
								baseUrl: state.cloud.origin,
								credential: "card",
								label: "P6 agent host",
								agent: "main",
							},
						},
					},
				],
				channels: { card: { type: "card", endpoint: state.cloud.origin } },
			}),
		);
		writeFileSync(
			join(agentDir.home, "agents/main/agent.yaml"),
			JSON.stringify({
				schema: 1,
				id: "main",
				name: "P6 Agent Host",
				owner: "person:owner",
				defaultProfile: "default",
				profiles: {
					default: {
						level: "bypass",
						plugins: ["devices"],
						tools: { offer: ["devices_list", "devices_describe", "devices_operation", "devices_status"], search: [] },
					},
				},
				bindings: [
					{
						id: "owner",
						match: { channel: "card", kind: "dm", from: "owner" },
						session: "main",
						profile: "default",
						wake: "run",
						reply: "auto",
					},
				],
			}),
		);
		state.agentHost = startAgentHost(agentDir.home);
		await waitFor(
			() => children.get(state.agentHost)?.log?.some((line) => line.includes("Yonder Harness started")),
			120_000,
			"agent host started",
		);
		const login = await new Promise((ok, ko) => {
			const child = track(
				spawn(
					process.execPath,
					[
						join(root, "packages/cli/dist/index.js"),
						"channels",
						"login",
						"card",
						"--home",
						agentDir.home,
						"--verify-code",
						invite.json.code,
						"--json",
					],
					{
						stdio: ["ignore", "pipe", "pipe"],
					},
				),
				"channels-login",
			);
			child.once("exit", (code) => ok({ code, out: children.get(child)?.log?.join("\n") ?? "" }));
			child.once("error", ko);
		});
		assert.match(login.out, /"status"\s*:\s*"connected"/, `card login failed: ${login.out.slice(-500)}`);
		// The card channel registers the device under the host name; the Bot is the named entity.
		state.agentDevice = await waitFor(
			async () => {
				const list = (await state.account("/api/devices")).json ?? [];
				const fresh = list.filter(
					(row) =>
						row.id !== state.harnessDevice.id &&
						row.id !== state.executorDevice.id &&
						row.online &&
						row.workProtocol === 1,
				);
				for (const row of fresh) {
					const agents = (await state.account(`/api/devices/${row.id}/agents`)).json ?? [];
					if (agents.some((entry) => entry.actor?.name === "P6 Agent Host")) return row;
				}
				return undefined;
			},
			120_000,
			"agent host device online",
		);
		// The devices plugin reads the card credential by name from the home's private auth file.
		const cardState = join(agentDir.home, ".yonder/plugins/channel-card/card.json");
		writeFileSync(
			join(agentDir.home, ".yonder/auth.json"),
			JSON.stringify({ card: { type: "api_key", key: JSON.parse(readFileSync(cardState, "utf8")).token } }),
			{ mode: 0o600 },
		);
		await stop(state.agentHost);
		state.agentHost = startAgentHost(agentDir.home);
		await waitFor(
			() => children.get(state.agentHost)?.log?.some((line) => line.includes("Yonder Harness started")),
			120_000,
			"agent host restarted",
		);
		await waitFor(
			async () => {
				const devices = (await state.account(`/api/devices/${state.executorDevice.id}/grants`)).json;
				return (
					devices?.observed && devices.grants?.some((grant) => !grant.revokedAt && grant.botLabel === "P6 Agent Host")
				);
			},
			120_000,
			"agent host introduced to the executor",
		);
		return `${state.agentDevice.name}（${state.agentDevice.id}），Bot「P6 Agent Host」已登记`;
	});

	// --- the loop in the web app ----------------------------------------------------------------------
	await run("网页设备列表显示两台设备与真实状态", async () => {
		await page.goto(`${state.web.origin}/me/devices`);
		await page.waitForText("设备", 30_000);
		await page.waitFor(`document.body.innerText.includes("外部 harness")`, 30_000, "harness kind word");
		const text = await page.eval("document.body.innerText");
		assert.ok(text.includes("在线"), "no online state word");
		assert.ok(text.includes("工作台 v1"), "no work protocol word");
		const rows = await page.eval(
			`[...document.querySelectorAll("a[href*='/me/devices/']")].map((a) => a.getAttribute("href"))`,
		);
		assert.ok(rows.includes(`/me/devices/${state.harnessDevice.id}`), "harness device missing from the list");
		assert.ok(rows.includes(`/me/devices/${state.executorDevice.id}`), "executor device missing from the list");
		return `${rows.length} 台设备，harness 行显示「在线 · 工作台 v1」`;
	});

	// A brand-new harness home has no sessions; the work bridge's `sessions.open` is how one appears
	// (spec 23 §2.4), and it must show up on the device page afterwards.
	if (state.hasDeepSeek) {
		await run("打开一个 DSH 会话（真实 work bridge）", async () => {
			const created = await state.account(`/api/devices/${state.harnessDevice.id}/work/rpc/sessions.open`, "POST", {
				preset: "standard",
			});
			assert.equal(created.status, 200, `sessions.open failed: ${JSON.stringify(created.json).slice(0, 200)}`);
			state.dshSession = created.json?.result?.id;
			assert.match(String(state.dshSession), /^session-/, "no harness session id");
			return state.dshSession;
		});
	}

	await run("设备详情列出 DSH 的 Bot 与会话", async () => {
		await page.goto(`${state.web.origin}/me/devices`);
		// `returnByValue` cannot serialize a DOM node; ask for a plain boolean.
		await page.waitFor(`!!document.querySelector("a[href*='/me/devices/']")`, 30_000, "device rows");
		// Click through the SPA router: a full page load would remount the shell and lose the work
		// bridge's online facts, which is a browser fresh-visit path the app also has to survive.
		await page.eval(`document.querySelector("a[href='/me/devices/${state.harnessDevice.id}']").click()`);
		try {
			await page.waitForText("外部 harness", 60_000);
		} catch (error) {
			throw new Error(
				`${clean(error)}; url=${await page.eval("location.href")}; page=${(await page.eval("document.body.innerText")).replace(/\s+/g, " ").slice(0, 400)}`,
			);
		}
		// The section's visible heading is 「会话」; 「这台设备的会话」 is only its aria-label.
		try {
			await page.waitFor(
				`!!document.querySelector("section[aria-label='这台设备的会话']")`,
				60_000,
				"sessions section",
			);
		} catch (error) {
			throw new Error(
				`${clean(error)}; url=${await page.eval("location.href")}; page=${(await page.eval("document.body.innerText")).replace(/\s+/g, " ").slice(0, 500)}`,
			);
		}
		await pause(1_000);
		await waitFor(
			async () => (await page.eval(`document.querySelectorAll("a[href*='/work/device/']").length > 0`)) === true,
			60_000,
			"session links",
		);
		const text = await page.eval("document.body.innerText");
		for (const bot of state.harnessBots)
			assert.ok(text.includes(bot.actor.name), `bot ${bot.actor.name} missing from the detail page`);
		assert.ok(!text.includes("执行端未登记"), "a harness device must not be reported as missing an executor");
		return `${state.harnessBots.length} 个 Bot，会话链接可用`;
	});

	if (!state.hasDeepSeek) {
		skip("在网页里打开 DSH 会话、提交输入、看流式输出、中止", "DSH 未启动（缺 DeepSeek 凭据）");
		skip("网页 DM DSH Bot 并收到真实 DeepSeek 回复", "DSH 未启动（缺 DeepSeek 凭据）");
	} else {
		await run("在网页里打开 DSH 会话、提交输入、看流式输出", async () => {
			await page.eval(`document.querySelector("a[href*='/work/device/']").click()`);
			// The composer's accessible name is its aria-label; 「消息输入框」 is never visible text.
			try {
				await page.waitFor(`!!document.querySelector("textarea[aria-label='消息输入框']")`, 90_000, "work composer");
			} catch (error) {
				throw new Error(
					`${clean(error)}; url=${await page.eval("location.href")}; page=${(await page.eval("document.body.innerText")).replace(/\s+/g, " ").slice(0, 500)}`,
				);
			}
			await waitFor(
				async () => await page.eval(`!!document.querySelector("textarea[aria-label='消息输入框']")`),
				30_000,
				"composer",
			);
			const marker = `p6-ui-${randomBytes(4).toString("hex")}`;
			await page.eval(`(() => {
        const box = document.querySelector("textarea[aria-label='消息输入框']");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(`Reply with exactly: ${marker}`)});
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
			await page.eval(`document.querySelector("button[aria-label='发送']").click()`);
			await waitFor(
				async () => await page.eval(`document.body.innerText.includes(${JSON.stringify(marker)})`),
				240_000,
				"streamed assistant reply in the web transcript",
			);
			// Wait for the finished bubble: the marker can appear in streaming text before it settles.
			const bubbles = await waitFor(
				async () => {
					const texts = await page.eval(
						`[...document.querySelectorAll("[data-testid='bubble-bot']")].map((node) => node.innerText)`,
					);
					const done = await page.eval(`!document.querySelector("[role='img'][aria-label='正在回复']")`);
					return Array.isArray(texts) && done && texts.some((text) => text.includes(marker)) ? texts : undefined;
				},
				120_000,
				"settled assistant bubble",
			);
			assert.ok(
				bubbles.some((text) => text.includes(marker)),
				"the reply must arrive as a bot bubble",
			);
			state.uiSessionUrl = await page.eval("location.href");
			return `流式输出里出现「${marker}」（${bubbles.length} 个 bot 气泡）`;
		});

		await run("提交一个长任务并在网页里中止该 DSH 会话", async () => {
			// The 中止 button only exists while the turn is running, so start a turn that takes a while.
			const marker = `p6-abort-${randomBytes(4).toString("hex")}`;
			await page.eval(`(() => {
        const box = document.querySelector("textarea[aria-label='消息输入框']");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(`Count from 1 to 400, one number per line, then end with ${marker}.`)});
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
			await page.eval(`document.querySelector("button[aria-label='发送']").click()`);
			const abort = await waitFor(
				async () => {
					const state = await page.eval(
						`(() => { const button = document.querySelector("[data-testid='abort']"); if (!button || button.disabled) return "absent"; button.click(); return "clicked"; })()`,
					);
					return state === "clicked" ? state : undefined;
				},
				120_000,
				"abort button while running",
			);
			assert.equal(abort, "clicked");
			// A real sessions.abort must stop the turn: the running indicator has to go away.
			await waitFor(
				async () => (await page.eval(`!document.querySelector("[data-testid='busy-bar']")`)) === true,
				120_000,
				"turn stopped",
			);
			// The marker text itself is in the *user* message, so look only at finished bot bubbles.
			const finalBubbles = await page.eval(
				`[...document.querySelectorAll("[data-testid='bubble-bot']")].map((node) => node.innerText)`,
			);
			assert.ok(
				!finalBubbles.some((text) => text.includes(marker)),
				"the aborted turn still produced its final answer",
			);
			return "运行中点了「中止」，忙碌条消失且最终答案未出现";
		});

		await run("网页 DM DSH Bot 并收到真实 DeepSeek 回复", async () => {
			const bot = state.harnessBots[0].actor;
			const dm = await state.account("/api/conversations/dm", "POST", { actorId: bot.id });
			assert.equal(dm.status, 200);
			const marker = `p6-chat-${randomBytes(4).toString("hex")}`;
			await page.goto(`${state.web.origin}/c/${dm.json.id}`);
			await page.waitFor(`!!document.querySelector("textarea[aria-label='输入消息']")`, 60_000, "chat composer");
			await page.eval(`(() => {
        const box = document.querySelector("textarea[aria-label='输入消息']");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(`Reply with exactly: ${marker}`)});
        box.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`);
			await page.eval(`document.querySelector("button[aria-label='发送']").click()`);
			await waitFor(
				async () => await page.eval(`document.body.innerText.includes(${JSON.stringify(marker)})`),
				240_000,
				"DSH bot reply in the web conversation",
			);
			return `网页 DM 收到「${marker}」`;
		});
	}

	// --- cloud Bot: real glm-5.3-flash through devices_list / devices_operation ------------------------
	if (!state.hasCloudModel) {
		skip("云端 Bot 用真实 glm-5.3-flash 读/写执行端设备上的文件", "本机没有 ~/.config/yonder/cloud-bot-model.key");
		skip("主人收窄后下一次调用被执行端拒绝", "云端 Bot 未启动");
	} else {
		await run("启动云端 Bot worker（真实 glm-5.3-flash）", async () => {
			state.worker = await startWorker({
				databaseUrl: state.services.databaseUrl,
				cloudOrigin: state.cloud.origin,
				workerKeyFile: state.workerKey,
				modelKeyFile: botModelKey,
			});
			const bot = await state.account("/api/me/default-bot", "POST", {});
			assert.equal(bot.status, 200);
			state.cloudBot = bot.json;
			const dm = await state.account("/api/conversations/dm", "POST", { actorId: bot.json.id });
			state.botConv = dm.json.id;
			state.botClient = client(state.cloud.origin, state.cookie);
			return `Bot ${bot.json.name}（${bot.json.id}）`;
		});

		const askBot = async (text, timeout = 300_000) => {
			const sent = await state.botClient(`/api/conversations/${state.botConv}/messages`, "POST", {
				content: { type: "text", text },
			});
			assert.equal(sent.status, 200);
			const started = Date.now();
			const reply = await waitFor(
				async () => {
					const history = await state.botClient(`/api/conversations/${state.botConv}/messages`);
					const items = Array.isArray(history.json) ? history.json : (history.json?.messages ?? []);
					const index = items.findIndex((item) => item.id === sent.json.id);
					return index < 0 ? undefined : items.slice(index + 1).find((item) => item.senderId === state.cloudBot.id);
				},
				timeout,
				"cloud bot reply",
			);
			return { reply, seconds: Math.round((Date.now() - started) / 1000) };
		};

		await run("云端 Bot 用 devices_list 读到执行端设备（真实模型回合）", async () => {
			const { reply, seconds } = await askBot(
				"请调用 devices_list 工具，然后原样返回工具结果里的 devices 数组（不要凭记忆编造）。",
			);
			const text = reply.content?.text ?? "";
			assert.equal(reply.content?.type, "markdown", `bot replied with ${reply.content?.type}: ${text.slice(0, 200)}`);
			assert.ok(
				text.includes(state.executorDevice.id) || text.includes("P6 Executor"),
				`devices_list result missing from reply: ${text.slice(0, 300)}`,
			);
			return `${seconds}s，回复里出现 P6 Executor 与 ${state.executorDevice.id}`;
		});

		const marker = `p6-cloud-${randomBytes(4).toString("hex")}`;
		const dataBase64 = Buffer.from(marker).toString("base64");
		await run("云端 Bot 用 devices_operation 写文件到执行端设备并读回", async () => {
			const write = await askBot(
				`请用 devices_operation 在设备 ${state.executorDevice.id} 上写文件：action "fs.write"，arguments {"path":"${join(execHome, "p6-cloud.txt")}","dataBase64":"${dataBase64}"}，commandId 用新 UUID ${randomUUID()}。原样报告工具返回值。`,
			);
			assert.equal(
				write.reply.content?.type,
				"markdown",
				`write failed: ${JSON.stringify(write.reply.content).slice(0, 300)}`,
			);
			assert.ok(existsSync(join(execHome, "p6-cloud.txt")), "the executor never wrote the file");
			assert.equal(readFileSync(join(execHome, "p6-cloud.txt"), "utf8"), marker);
			const read = await askBot(
				`请用 devices_operation 读回设备 ${state.executorDevice.id} 上的 ${join(execHome, "p6-cloud.txt")}（action "fs.read"，commandId 用新 UUID ${randomUUID()}），原样报告内容。`,
			);
			assert.equal(
				read.reply.content?.type,
				"markdown",
				`read failed: ${JSON.stringify(read.reply.content).slice(0, 300)}`,
			);
			assert.ok(
				(read.reply.content.text ?? "").includes(dataBase64) || (read.reply.content.text ?? "").includes(marker),
				"the read-back value is missing from the reply",
			);
			return `执行端文件内容为 ${marker}（写 ${write.seconds}s，读回 ${read.seconds}s）`;
		});

		await run("主人在网页 Bot 详情把可操作设备收窄到另一台设备", async () => {
			await page.goto(`${state.web.origin}/contacts/${state.cloudBot.code ?? state.cloudBot.id}`);
			await page.waitForText("可操作的设备", 60_000);
			await page.eval(clickByText("收窄"));
			await page.waitFor(
				`[...document.querySelectorAll("input[type=checkbox]")].length > 0`,
				30_000,
				"device checkboxes",
			);
			const boxes = await page.eval(
				`[...document.querySelectorAll("input[type=checkbox]")].map((box) => box.getAttribute("aria-label"))`,
			);
			// Keep only the harness device (its accessible name carries the kind, so the executor with
			// the same host name stays distinguishable): the executor must drop out of this Bot's scope.
			await page.eval(`(() => {
        const keep = ${JSON.stringify(`允许 ${state.harnessName} · 外部 harness`)};
        for (const box of document.querySelectorAll("input[type=checkbox]")) {
          if (box.getAttribute("aria-label") !== keep && box.checked) box.click();
        }
        return true;
      })()`);
			await page.eval(clickByText("只允许选中的设备"));
			await page.waitForText("已更新可操作设备", 30_000);
			const scope = await state.account(`/api/bots/${state.cloudBot.id}/devices`);
			assert.equal(scope.json.mode, "selected");
			assert.deepEqual(scope.json.allowed, [state.harnessDevice.id]);
			return `${boxes.length} 台可选，收窄为 ${state.harnessDevice.name}`;
		});

		await run("下一次调用：执行端不再有该 Bot 的授权，网页显示真实原因", async () => {
			// The server's own 5-minute deadline writes a real error into the same result slot; wait past it
			// so the step records what the user actually sees instead of a client-side timeout.
			const { reply } = await askBot(
				`请再试一次用 devices_operation 在设备 ${state.executorDevice.id} 上写 ${join(execHome, "p6-denied.txt")}。如果找不到工具或被拒绝，原样说明你看到的原因，不要编造成功。`,
				420_000,
			);
			const text = reply.content?.text ?? "";
			assert.ok(!existsSync(join(execHome, "p6-denied.txt")), "the narrowed Bot still wrote on the executor");
			assert.ok(
				!/成功|已写入|written/i.test(text) || /不能|无法|没有|拒绝/.test(text),
				`the bot claimed success: ${text.slice(0, 200)}`,
			);
			// The executor side, read back through the owner's own grant view.
			const grants = await state.account(`/api/devices/${state.executorDevice.id}/grants`);
			const live = (grants.json?.grants ?? []).filter((grant) => !grant.revokedAt);
			assert.ok(
				!live.some((grant) => grant.botId === state.cloudBot.id),
				"the executor still holds a live grant for the narrowed Bot",
			);
			return `回复「${text.replace(/\s+/g, " ").slice(0, 120)}」；执行端对该 Bot 的生效 grant 已撤`;
		});
	}

	// --- uninstall -----------------------------------------------------------------------------------
	await run("yonder-connect dsh --remove 卸载连接器", async () => {
		await stop(state.dshProcess);
		const result = execFileSync(
			process.execPath,
			[join(root, "packages/connect/dist/cli.js"), "dsh", "--remove", "--profile", "p6"],
			{ encoding: "utf8", env: { ...process.env, DSH_HOME: dshHome } },
		);
		assert.ok(
			!existsSync(join(dshHome, "yonder")),
			`the connector state directory survived --remove: ${result.slice(0, 300)}`,
		);
		const bundles =
			JSON.parse(readFileSync(join(dshHome, "profiles/p6/package.json"), "utf8"))?.dsh?.profile?.bundles ?? [];
		assert.ok(!bundles.includes("@yonder/dsh-connector"), "the bundle is still listed in the profile");
		return "bundle 从 profile 移除，$DSH_HOME/yonder/ 已清除";
	});

	await run("卸载后 DSH 与安装前一致（逐文件对比 + 正常启动）", async () => {
		const after = snapshotTree(dshHome);
		const residue = diffTrees(state.dshSnapshot, after);
		// Classify every difference instead of asserting "nothing changed": DSH writes its own runtime
		// state on any boot (sessions, credentials, the composed profile), and 23 §5 lists the plugin
		// manager's leftovers. Anything else would be connector residue.
		const documented = (path) => /(\.plugin-manager\/|pnpm-lock\.yaml|node_modules\/)/.test(path);
		const dshOwned = (path) =>
			path === "sessions/" ||
			path.startsWith("sessions/") ||
			path.startsWith("storages/") ||
			path === ".credentials.yaml" ||
			path === ".anonymous-user-id" ||
			path === "profiles/p6/cordis.yml" ||
			path === "profiles/p6/package.json";
		const unexpected = residue.filter((path) => !documented(path) && !dshOwned(path));
		assert.deepEqual(unexpected, [], `unexpected residue: ${unexpected.join(", ")}`);
		state.residue = {
			documented: residue.filter(documented),
			dshOwned: residue.filter((path) => !documented(path) && dshOwned(path)),
		};
		const boot = track(
			spawn(state.dsh, ["--profile", "p6", "--no-open", "--port", String(portBase + 11)], {
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, DSH_HOME: dshHome },
			}),
			"dsh-after-remove",
		);
		await waitFor(
			() => children.get(boot)?.log?.some((line) => line.includes("dsh web:")),
			180_000,
			"DSH boots after uninstall",
		);
		await stop(boot);
		await pause(1_500);
		const device = (await state.account("/api/devices")).json?.find((row) => row.id === state.harnessDevice.id);
		assert.ok(!device?.online, "the connector device is still online after removal");
		return `残留 ${residue.length} 项：连接器/插件管理器 ${state.residue.documented.length} 项（23 §5 列举内），DSH 自身运行状态 ${state.residue.dshOwned.length} 项；DSH 照常启动`;
	});
} catch (error) {
	console.error(`\np6 e2e failed: ${clean(error)}`);
	if (state.dshProcess) console.error(`  dsh: ${tail(state.dshProcess)}`);
	if (state.agentHost) console.error(`  agent host: ${tail(state.agentHost)}`);
	if (state.worker) console.error(`  worker: ${tail(state.worker)}`);
	process.exitCode = 1;
} finally {
	state.browser?.page.close();
	for (const child of [...children.keys()]) await stop(child).catch(() => {});
	await state.services?.close().catch((error) => console.error(`services: ${clean(error)}`));
	if (!keep) rmSync(folder, { recursive: true, force: true });
	else console.log(`kept ${folder}`);

	const width = Math.max(...stepRows.map((row) => [...row.name].length), 8);
	console.log("\n步骤".padEnd(width + 2) + "结果    说明");
	for (const row of stepRows) console.log(`${row.name.padEnd(width + 2)}${row.result.padEnd(8)}${row.detail}`);
	if (untested.length) {
		console.log("\n未测：");
		for (const item of untested) console.log(`  - ${item}`);
	}
	const failed = stepRows.filter((row) => row.result === "失败").length;
	console.log(`\n${stepRows.length - failed - untested.length} 通过 / ${failed} 失败 / ${untested.length} 未测`);
}

/** Path → size/mtime map of a directory tree, for the uninstall comparison (23 §5). */
function snapshotTree(dir, base = dir, out = new Map()) {
	const walk = (current) => {
		for (const name of readdirSync(current).sort()) {
			const path = join(current, name);
			const info = statSync(path);
			const relative = path.slice(base.length + 1);
			if (info.isDirectory()) {
				out.set(`${relative}/`, "dir");
				walk(path);
			} else out.set(relative, `${info.size}:${Math.round(info.mtimeMs)}`);
		}
	};
	walk(dir);
	return out;
}

function diffTrees(before, after) {
	const changed = [];
	for (const [path, value] of after) if (before.get(path) !== value) changed.push(path);
	for (const path of before.keys()) if (!after.has(path)) changed.push(`${path} (removed)`);
	return changed;
}
