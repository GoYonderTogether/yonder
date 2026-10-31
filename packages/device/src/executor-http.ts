import { createServer, type RequestListener, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
import type { SignedEnvelope } from "@yonder/protocol";
import { fail } from "./executor-support.js";

/** Loopback HTTP is test-only; private-network listening requires TLS. */
export async function serveExecution(
	handle: (envelope: unknown) => Promise<SignedEnvelope>,
	options: { host: string; port: number; tls?: { key: Buffer; cert: Buffer } },
	onServer: (server: Server | HttpsServer) => void,
): Promise<number> {
	if (isIP(options.host) === 0 || (options.host !== "127.0.0.1" && !options.tls)) fail("UNAUTHORIZED");
	const handler: RequestListener = async (req, res) => {
		if (req.method !== "POST" || req.url !== "/execution/v1") {
			res.writeHead(404).end();
			return;
		}
		try {
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of req) {
				size += chunk.length;
				if (size > 1_500_000) fail("INVALID_REQUEST");
				chunks.push(chunk);
			}
			const answer = await handle(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
		} catch {
			res.writeHead(400).end();
		}
	};
	const server = options.tls ? createHttpsServer(options.tls, handler) : createServer(handler);
	onServer(server);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return (server.address() as { port: number }).port;
}
