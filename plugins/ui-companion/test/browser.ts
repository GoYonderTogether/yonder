import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

export const chromePath =
	process.env.YONDER_TEST_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export async function browser() {
	const directory = await mkdtemp(join(tmpdir(), "yonder-board-browser-"));
	const child = spawn(
		chromePath,
		[
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--no-proxy-server",
			"--no-first-run",
			"--no-default-browser-check",
			"--remote-debugging-port=0",
			`--user-data-dir=${directory}`,
			"about:blank",
		],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	let diagnostic = "";
	child.stderr?.on("data", (data) => {
		diagnostic = (diagnostic + String(data)).slice(-4000);
	});
	let port = "";
	for (let attempt = 0; attempt < 300 && !port; attempt++) {
		try {
			port = (await readFile(join(directory, "DevToolsActivePort"), "utf8")).split("\n")[0]!;
		} catch {
			await setTimeout(50);
		}
	}
	if (!port) {
		if (child.exitCode === null) {
			const stopped = once(child, "exit");
			child.kill();
			await stopped;
		}
		await rm(directory, { recursive: true, force: true });
		throw new Error(`Chrome did not start within 15 seconds: ${diagnostic}`);
	}
	const page = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as {
		webSocketDebuggerUrl: string;
	};
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
	let next = 0;
	const errors: unknown[] = [];
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	socket.addEventListener("message", (event) => {
		const packet = JSON.parse(String(event.data));
		if (packet.method === "Runtime.exceptionThrown") errors.push(packet.params);
		const call = pending.get(packet.id);
		if (!call) return;
		pending.delete(packet.id);
		if (packet.error) call.reject(new Error(JSON.stringify(packet.error)));
		else call.resolve(packet.result);
	});
	const command = (method: string, params: object = {}) =>
		new Promise<any>((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression: string) => {
		const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
		return result.result.value;
	};
	await command("Runtime.enable");
	return {
		command,
		evaluate,
		async wait(expression: string) {
			for (let attempt = 0; attempt < 100; attempt++) {
				if (await evaluate(expression)) return;
				await setTimeout(50);
			}
			throw new Error(
				`Browser condition timed out: ${expression}\n${JSON.stringify(errors)}\n${await evaluate("JSON.stringify({url:location.href, ready:document.readyState, html:document.documentElement.outerHTML.slice(-1500)})")}`,
			);
		},
		async close() {
			socket.close();
			const stopped = once(child, "exit");
			child.kill();
			await stopped;
			await rm(directory, { recursive: true, force: true });
		},
	};
}
