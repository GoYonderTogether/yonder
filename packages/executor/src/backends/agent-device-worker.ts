// Runs only as an owned Linux child. This file is compiled alongside the provider.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
type DriverClient = {
	apps: { open(options: Record<string, unknown>): Promise<unknown> };
	capture: {
		snapshot(options: Record<string, unknown>): Promise<{ nodes?: unknown[] }>;
		screenshot(options: Record<string, unknown>): Promise<{ path: string }>;
	};
	interactions: {
		click(options: Record<string, unknown>): Promise<unknown>;
		type(options: Record<string, unknown>): Promise<unknown>;
		scroll(options: Record<string, unknown>): Promise<unknown>;
	};
	command: { back(options: Record<string, unknown>): Promise<unknown> };
};
let host: { client: DriverClient; close(): Promise<unknown> } | undefined;
try {
	// Entry is resolved and version-checked by the trusted provider, never from action arguments.
	const sdk = await import(pathToFileURL(input.entry).href);
	host = await sdk.startAgentDevice({ stateDir: input.stateDir });
	if (!host) throw new Error("Missing SDK host");
	const client = host.client;
	const scope = { platform: "linux", session: "yonder-local-desktop" };
	let result: unknown;
	if (input.action === "probe") {
		// A static supported-command table is not a probe of the live display or AT-SPI bus.
		await client.apps.open({ ...scope, surface: "desktop", noRecord: true });
		const tree = await client.capture.snapshot({ ...scope, depth: 1 });
		result = { tree: Array.isArray(tree.nodes) };
	} else {
		await client.apps.open({ ...scope, surface: "desktop", noRecord: true });
		switch (input.action) {
			case "probe-screen": {
				const shot = await client.capture.screenshot({ ...scope, path: `${input.stateDir}/probe.png` });
				const data = await readFile(shot.path);
				result = { screen: data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) };
				break;
			}
			case "snapshot":
				result = await client.capture.snapshot({ ...scope, depth: 12 });
				break;
			case "screenshot": {
				const shot = await client.capture.screenshot({ ...scope, path: `${input.stateDir}/screen.png` });
				const data = await readFile(shot.path);
				if (data.length > 600_000 || !data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
					throw new Error("Screenshot is not a PNG within the protocol byte budget");
				result = { mime: "image/png", dataBase64: data.toString("base64") };
				break;
			}
			case "click":
				result = await client.interactions.click({ ...scope, x: input.args.x, y: input.args.y });
				break;
			case "type":
				result = await client.interactions.type({ ...scope, text: input.args.text });
				break;
			case "scroll":
				result = await client.interactions.scroll({
					...scope,
					direction: input.args.direction,
					pixels: input.args.pixels,
				});
				break;
			case "back":
				result = await client.command.back(scope);
				break;
			default:
				throw new Error("Unsupported local action");
		}
	}
	await host.close();
	host = undefined;
	process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
	await host?.close().catch(() => {});
	const code = (error as { code?: string }).code;
	process.stdout.write(JSON.stringify({ ok: false, code: code ?? "DRIVER_ERROR" }));
}
