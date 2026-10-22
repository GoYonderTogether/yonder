import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";

test("actual allowlisted HTTPS body/header injection verifies TLS, discards response secrets and refuses redirect", async () => {
	const root = await realpath(await mkdtemp(join(tmpdir(), "clip-tls-"))),
		key = join(root, "key.pem"),
		cert = join(root, "cert.pem");
	const secret = randomBytes(40).toString("hex"),
		requests: Array<{ path: string; body: string; header: string | undefined }> = [];
	let server: ReturnType<typeof createServer> | undefined;
	try {
		execFileSync(
			"/usr/bin/openssl",
			[
				"req",
				"-x509",
				"-newkey",
				"rsa:2048",
				"-nodes",
				"-keyout",
				key,
				"-out",
				cert,
				"-days",
				"1",
				"-subj",
				"/CN=localhost",
				"-addext",
				"subjectAltName=IP:127.0.0.1",
			],
			{ stdio: "ignore" },
		);
		server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk);
			requests.push({
				path: req.url!,
				body: Buffer.concat(chunks).toString(),
				header: req.headers["x-clip-secret"] as string | undefined,
			});
			if (req.url === "/redirect") {
				res.writeHead(302, { location: "https://127.0.0.1:1/should-not-follow" });
				res.end();
			} else {
				res.writeHead(req.url === "/reject" ? 403 : 200);
				res.end(secret);
			}
		});
		await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
		const addr = server.address() as { port: number };
		async function consume(path: string, header = false, trust = true) {
			const url = `https://127.0.0.1:${addr.port}${path}`,
				module = pathToFileURL(resolve("plugins/clipboard/dist/consumers.js")).href;
			const code = `import {consume} from ${JSON.stringify(module)}; const chunks=[];for await(const c of process.stdin)chunks.push(c);try{const r=await consume(JSON.parse(process.argv[1]),Buffer.concat(chunks),AbortSignal.timeout(5000));console.log(JSON.stringify(r));}catch{console.log(JSON.stringify({failed:true}));}`;
			const consumer = { kind: "http", url, method: "POST", ...(header ? { header: "X-Clip-Secret" } : {}) };
			return new Promise<string>((resolve, reject) => {
				const child = spawn(process.execPath, ["--input-type=module", "-e", code, JSON.stringify(consumer)], {
					env: { PATH: "/usr/bin:/bin", ...(trust ? { NODE_EXTRA_CA_CERTS: cert } : {}) },
					stdio: ["pipe", "pipe", "ignore"],
				});
				let output = "";
				child.stdout.on("data", (c) => {
					output += c;
				});
				child.on("error", reject);
				child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error("http fixture failed"))));
				child.stdin.end(secret);
			});
		}
		expect(JSON.parse(await consume("/body"))).toEqual({ ok: true, status: 200 });
		expect(requests.at(-1)?.body === secret).toBe(true);
		expect(JSON.parse(await consume("/header", true))).toEqual({ ok: true, status: 200 });
		expect(requests.at(-1)?.header === secret).toBe(true);
		expect(requests.at(-1)?.body).toBe("");
		expect(JSON.parse(await consume("/reject"))).toEqual({ ok: false, status: 403 });
		expect(JSON.parse(await consume("/redirect"))).toEqual({ failed: true });
		const before = requests.length;
		expect(JSON.parse(await consume("/body", false, false))).toEqual({ failed: true });
		expect(requests).toHaveLength(before);
	} finally {
		await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
		await rm(root, { recursive: true, force: true });
	}
}, 30000);
