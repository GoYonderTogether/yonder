import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel } from "@yonder/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { parse, stringify } from "yaml";
import { type GatewayHandle, startGateway } from "../src/index.js";

// Real kernel with a probe plugin that reports pending questions through api.activity.questions.
let home: string;
let kernel: Awaited<ReturnType<typeof openKernel>>;
let gateway: GatewayHandle;
let base: string;
const pending = globalThis as unknown as { __probeQuestions: number };

type Frame = { t: string; sub?: string; data?: unknown; result?: unknown; [key: string]: unknown };

beforeAll(async () => {
	home = await mkdtemp("/tmp/yonder-gateway-activity-");
	await initHome(home);
	const dir = join(home, "probe");
	await mkdir(dir);
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({
			type: "module",
			version: "1.0.0",
			yonder: { apiVersion: 1, id: "question-probe", entry: "./index.mjs", contributes: {} },
		}),
	);
	await writeFile(
		join(dir, "index.mjs"),
		"export default { setup(api) { api.activity.questions(() => globalThis.__probeQuestions); } };",
	);
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.plugins.push({ use: "./probe" });
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	pending.__probeQuestions = 2;
	kernel = await openKernel(home);
	gateway = await startGateway({
		home,
		host: { kernel, home, releaseInfo: async () => ({}) as never, awakeStatus: () => ({}), stop: () => {} },
	});
	base = `http://127.0.0.1:${gateway.port}`;
}, 60_000);

afterAll(async () => {
	await gateway?.close();
	await kernel?.close();
	await rm(home, { recursive: true, force: true });
});

describe("activity.watch over the gateway", () => {
	it("reports running, waiting and questions, and pushes a change", async () => {
		const state = JSON.parse(await readFile(join(home, ".yonder", "gateway.json"), "utf8")) as { token: string };
		const login = await fetch(`${base}/?token=${state.token}`, { redirect: "manual" });
		const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const rpc = async (method: string, params: unknown = {}) =>
			(await (
				await fetch(`${base}/api/rpc/${method}`, {
					method: "POST",
					headers: { "content-type": "application/json", cookie, origin: base },
					body: JSON.stringify(params),
				})
			).json()) as { ok: boolean; result?: Record<string, unknown> };
		// An open but idle session counts as neither running nor waiting.
		await rpc("sessions.open", { preset: "default" });
		expect((await rpc("activity.summary")).result).toMatchObject({ running: 0, waiting: 0, questions: 2 });

		const frames: Frame[] = [];
		const ws = new WebSocket(`${base.replace("http", "ws")}/api/stream?v=1`, { headers: { origin: base, cookie } });
		ws.on("message", (data) => frames.push(JSON.parse(String(data)) as Frame));
		await new Promise((resolve, reject) => ws.on("open", resolve).on("error", reject));
		ws.send(JSON.stringify({ t: "sub", sub: "a", method: "activity.watch", params: {} }));
		const until = async (match: (f: Frame) => boolean) => {
			for (let i = 0; i < 200; i++) {
				const found = frames.find(match);
				if (found) return found;
				await new Promise((r) => setTimeout(r, 25));
			}
			throw new Error("frame not received");
		};
		const ready = await until((f) => f.t === "ready");
		expect(ready.gap).toBe(true);
		expect(ready.result).toMatchObject({ running: 0, waiting: 0, questions: 2 });

		pending.__probeQuestions = 3;
		const ev = await until((f) => f.t === "ev" && f.type === "activity.summary");
		expect(ev.data).toMatchObject({ running: 0, waiting: 0, questions: 3 });
		ws.close();
	}, 30_000);
});
