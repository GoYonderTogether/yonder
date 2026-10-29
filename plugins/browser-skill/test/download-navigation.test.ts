import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { navigationNotice, settledDownload } from "../src/index.js";
import { BskError, parseBskJson } from "../src/runner.js";

// 真实本地站点：不连外网，也不伪造模型或页面数据。
const payload = Buffer.alloc(1_500_000, 7);
const chunk = 200_000;
let server: Server;
let origin = "";

beforeAll(async () => {
	server = createServer((request, response) => {
		if (request.url === "/redirect") {
			response.writeHead(302, { location: "/landing" });
			response.end();
			return;
		}
		if (request.url === "/file.bin") {
			response.writeHead(200, {
				"content-type": "application/octet-stream",
				"content-length": String(payload.length),
			});
			// 慢慢发，让「还在写」和「写完了」都能被真实观察到。
			let offset = 0;
			const step = () => {
				if (offset >= payload.length) {
					response.end();
					return;
				}
				response.write(payload.subarray(offset, offset + chunk));
				offset += chunk;
				setTimeout(step, 120);
			};
			step();
			return;
		}
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end("<!doctype html><title>probe</title><a id=d href=/file.bin>download</a>");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("local server did not bind a port");
	origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("download completion and navigation on a real local site", () => {
	it("waits for the file to stop growing instead of trusting bsk's own timeout", async () => {
		const directory = await mkdtemp(join(tmpdir(), "yonder-bsk-download-"));
		const path = join(directory, "file.bin");
		try {
			// 真实分块下载：先观察到「还没写完」，收完再观察到「完整」，而不是只信一次超时。
			const downloading = fetch(`${origin}/file.bin`).then(async (response) => {
				const handle = await open(path, "w");
				for await (const part of response.body ?? []) await handle.write(part);
				await handle.close();
				return (await stat(path)).size;
			});
			await new Promise((resolve) => setTimeout(resolve, 200));
			expect((await settledDownload(path, 400)).complete).toBe(false);
			expect(await downloading).toBe(payload.length);
			expect(await settledDownload(path)).toEqual({ size: payload.length, complete: true });
			// 文件根本不存在时不能当成完成。
			expect(await settledDownload(join(directory, "missing.bin"), 400)).toEqual({ size: 0, complete: false });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("tells the next step when navigation lands elsewhere or stays blank", async () => {
		const response = await fetch(`${origin}/redirect`);
		expect(response.url).toBe(`${origin}/landing`);
		const redirected = navigationNotice(origin, { final_url: response.url });
		expect(redirected?.error).toBe(false);
		expect(redirected?.finalUrl).toBe(`${origin}/landing`);
		expect(redirected?.hint).toContain("fetch");
		expect(navigationNotice(`${origin}/landing/`, { final_url: `${origin}/landing` })).toBeUndefined();
		const blank = navigationNotice(origin, { final_url: "about:blank" });
		expect(blank?.error).toBe(true);
		expect(blank?.hint).toContain("fetch");
	});
	it("puts an actionable hint on a timed-out bsk run", () => {
		const error = (() => {
			try {
				parseBskJson({ code: null, stdout: "", stderr: "", timedOut: true, aborted: false }, "download");
			} catch (thrown) {
				return thrown;
			}
			return undefined;
		})();
		expect(error).toBeInstanceOf(BskError);
		expect((error as BskError).timedOut).toBe(true);
		expect((error as BskError).hint).toContain("fetch");
	});
});
