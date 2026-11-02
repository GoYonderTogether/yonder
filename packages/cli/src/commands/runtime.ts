import { createConnection } from "node:net";
import { env, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import {
	cliChannelEndpoint,
	controlHandler,
	gatewaySettings,
	offlineQuery,
	openKernel,
	releaseInfo,
	requestControl,
	serveControl,
} from "@yonder/core";
import { startGateway, workControl } from "@yonder/gateway";
import type { OutputPart } from "@yonder/sdk";
import { installPower, setAwake, startAwake } from "../awake.js";
import { startStatusSurface } from "../status-surface.js";
import { uiCommand } from "../ui-command.js";
import { homeFor, type Options, output, print, UsageError } from "./context.js";

/** `awake`, `start`, `ui` and `stop`. */
export async function runRuntime(command: string, options: Options, rest: string[]): Promise<number | undefined> {
	if (command === "awake") {
		const [action, value] = rest;
		if (action === "install" && rest.length === 1) return print(installPower(), options.json);
		if (action === "status" && rest.length === 1)
			return print(requestControl(homeFor(options), { method: "awake.status" }), options.json);
		if (
			action === "set" &&
			rest.length === 2 &&
			(value === "on" || value === "off" || value === "tasks" || value === "always")
		)
			return print(setAwake(homeFor(options), value === "on" ? "tasks" : value), options.json);
		throw new UsageError("Usage: yonder awake status|install|set off|tasks|always");
	}
	if (command === "start") return start(options, rest);
	if (command === "ui") {
		const home = homeFor(options);
		const rotate = rest[0] === "token" && rest[1] === "--rotate" && rest.length === 2;
		const open = rest.length === 1 && rest[0] === "--open";
		if (!rotate && !open && rest.length) throw new UsageError("Usage: yonder ui [--open] | yonder ui token --rotate");
		output(await uiCommand(home, rotate, open, options.json), options.json);
		return 0;
	}
	if (command !== "stop") return undefined;
	if (rest.length) throw new UsageError("Usage: yonder stop");
	await requestControl(homeFor(options), { method: "stop" });
	output({ stopping: true }, options.json);
	return 0;
}

async function start(options: Options, rest: string[]): Promise<number> {
	if (rest.some((arg) => arg !== "--no-gateway")) throw new UsageError("Usage: yonder start [--no-gateway]");
	const home = homeFor(options);
	env.YONDER_HOME = home;
	const plugins = (await offlineQuery(home, { method: "management", params: { action: "plugins.list" } })) as Array<{
		id: string;
	}>;
	if (!plugins.some((plugin) => plugin.id === "interaction"))
		await offlineQuery(home, {
			method: "management",
			params: { action: "plugins.add", source: "@yonder/plugin-interaction" },
		});
	const kernel = await openKernel(home, {
		log: (level, message, data) =>
			output({ ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) }, options.json),
	});
	const awake = startAwake(home, () => kernel.awakeActivity());
	// 状态面：服务自己把"现在怎么样"写成一份小文件，读取方读文件而不是派生进程。
	const status = startStatusSurface(home, kernel);
	let closing: Promise<void> | undefined;
	let control: Awaited<ReturnType<typeof serveControl>> | undefined;
	let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
	let finish!: () => void;
	const stopped = new Promise<void>((resolve) => {
		finish = resolve;
	});
	let finishStartup!: () => void;
	const startup = new Promise<void>((resolve) => {
		finishStartup = resolve;
	});
	const stop = () => {
		if (closing) return closing;
		closing = (async () => {
			// A stop can arrive while the gateway is still creating its listener/descriptor.
			await startup;
			awake.close();
			await status.stop();
			await gateway?.close();
			await control?.close();
			await kernel.close();
			finish();
		})();
		return closing;
	};
	try {
		const host: Parameters<typeof controlHandler>[0] = {
			kernel,
			home,
			releaseInfo: () => releaseInfo(home),
			awakeStatus: () => awake.status(),
			stop: () => void stop(),
		};
		kernel.setWorkHost((id) => workControl(host, id));
		if (!rest.includes("--no-gateway") && (await gatewaySettings(home)).enabled) {
			gateway = await startGateway({ home, host });
			host.gateway = gateway;
			output({ gateway: `http://127.0.0.1:${gateway.port}/` }, options.json);
		}
		// Publishing control is the startup-ready boundary, after every listener is owned.
		control = await serveControl(home, controlHandler(host));
	} catch (error) {
		finishStartup();
		await stop();
		throw error;
	} finally {
		finishStartup();
	}
	const signal = () => void stop();
	process.once("SIGINT", signal);
	process.once("SIGTERM", signal);
	await stopped;
	process.off("SIGINT", signal);
	process.off("SIGTERM", signal);
	return 0;
}

/** Non-interactive `yonder chat`: stdout part stream over the instance's local socket. */
export async function chat(home: string, instance: string, json: boolean) {
	const socket = createConnection(cliChannelEndpoint(home, instance));
	socket.setEncoding("utf8");
	const lines = createInterface({ input: socket, crlfDelay: Infinity });
	const terminal = createInterface({ input: stdin, output: json ? stderr : stdout, terminal: stdin.isTTY });
	let streamed = "";
	const fromOutput = (part: OutputPart | { type: "message"; text: string } | { type: "error"; message: string }) => {
		if (part.type === "text") {
			streamed += part.delta;
			if (json) output(part, true);
			else stdout.write(part.delta);
		} else if (part.type === "final") {
			if (json) output(part, true);
			else {
				if (streamed) stdout.write("\n");
				if (part.text && part.text !== streamed) stdout.write(`${part.text}\n`);
			}
			streamed = "";
		} else if (part.type === "message") output(part.text, json);
		else if (part.type === "tool") {
			if (json) output(part, true);
			else if (part.phase === "start") stderr.write(`[${part.name}] ${part.label ?? ""}\n`);
		} else if (part.type === "error") {
			if (json) output(part, true);
			else stderr.write(`${part.message}\n`);
		}
	};
	lines.on("line", (line) => {
		try {
			fromOutput(JSON.parse(line) as Parameters<typeof fromOutput>[0]);
		} catch (error) {
			stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		}
	});
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
			lines.once("error", reject);
		}).catch((error: NodeJS.ErrnoException) => {
			// 名片等非 cli 渠道没有本地会话 socket；直接报 ENOENT 会误导成服务问题（JV2-J03-08）。
			if (instance !== "cli" && (error.code === "ENOENT" || error.code === "ECONNREFUSED"))
				throw new Error(
					`渠道 ${instance} 没有本地对话入口 / Channel ${instance} has no local chat endpoint. 主人与 main Agent 对话请用 yonder chat --channel cli（名片起草工具在该会话可用）；或在 ${instance} 渠道直接发消息。`,
				);
			throw error;
		});
		socket.once("close", () => terminal.close());
		for await (const line of terminal) {
			if (socket.destroyed) break;
			socket.write(`${line}\n`);
		}
		if (!socket.destroyed) {
			const closed = new Promise<void>((resolve) => socket.once("close", resolve));
			socket.end();
			await closed;
		}
	} finally {
		terminal.close();
		socket.destroy();
	}
}
