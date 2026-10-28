import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { afterEach, expect, test } from "vitest";
import { BoardService } from "../../tasks/src/service.js";
import { Store } from "../../tasks/src/store/index.js";
import { CompanionService } from "../src/service.js";

// Real loopback HTTP and temporary stores. Upstream protocol failures are controlled
// HTTP servers, not mocks of fetch, timers, task storage, or production services.
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function temporary() {
	const directory = await mkdtemp(join(tmpdir(), "yonder-activity-ui-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return directory;
}
async function companion() {
	const directory = await temporary();
	const service = new CompanionService(directory, true);
	await service.start();
	cleanups.push(() => service.stop());
	return { service, directory };
}
async function upstream(listener: RequestListener) {
	const server = createServer(listener);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	cleanups.push(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No loopback listener");
	return `http://127.0.0.1:${address.port}`;
}
async function publish(service: CompanionService, source: string, id?: string) {
	const response = await fetch(`${service.url}board`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source, id }),
	});
	expect(response.status).toBe(200);
	return response.json();
}
async function summary(service: CompanionService) {
	const response = await fetch(`${service.url}activity-summary`);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	return response.json();
}
const envelope = (sourceRevision: number, availability: string) => ({ schemaVersion: 1, sourceRevision, availability });
const payload = {
	schemaVersion: 1,
	observedAt: 123,
	agents: [{ agentId: "protocol", blocked: 1, review: 0, waitingUser: 0 }],
};

test("unpublished summary is private, read-only, and stays unpublished across restart", async () => {
	const { service, directory } = await companion();
	expect(await summary(service)).toEqual(envelope(0, "unpublished"));
	expect((await fetch(new URL("/activity-summary", service.url))).status).toBe(403);
	expect(
		(await fetch(`${service.url}activity-summary`, { headers: { Origin: "https://foreign.invalid" } })).status,
	).toBe(403);
	expect((await fetch(`${service.url}activity-summary`, { method: "POST" })).status).toBe(404);
	await service.stop();
	expect(service.url).toBe("");
	await expect(readFile(join(directory, "desktop.json"))).rejects.toMatchObject({ code: "ENOENT" });
	await expect(readFile(join(directory, "renderer.json"))).rejects.toMatchObject({ code: "ENOENT" });
	await service.start();
	expect(await summary(service)).toEqual(envelope(0, "unpublished"));
});

test("current caller board updates are fetched afresh and never merged or persisted", async () => {
	const directory = await temporary();
	const store = new Store(directory);
	cleanups.push(async () => store.close());
	const board = new BoardService(store, "en", 0);
	await board.start();
	cleanups.push(() => board.stop());
	const { service, directory: uiDirectory } = await companion();
	const caller = (agent: string): ToolContext => ({
		agent,
		session: "1",
		profile: "owner",
		capabilities: ["read"],
		env: {} as never,
		signal: new AbortController().signal,
	});
	const a = caller("a"),
		b = caller("b");
	const content = {
		title: "Private protocol task",
		objective: "Check caller scope",
		acceptance: ["Scope checked"],
		nonGoals: [],
	};
	const first = store.open(content, a),
		second = store.open(content, b);
	store.update(first.id, { state: "active" }, a);
	store.update(first.id, { state: "blocked" }, a);
	store.update(second.id, { state: "active" }, b);
	store.update(second.id, { state: "review" }, b);
	const sourceA = board.publish(a),
		sourceB = board.publish(b);
	expect(await publish(service, sourceA, first.id)).toMatchObject({ view: "detail", url: service.url });
	expect(await summary(service)).toMatchObject({
		...envelope(1, "available"),
		summary: { agents: [{ agentId: "a", blocked: 1, review: 0, waitingUser: 0 }] },
	});
	store.update(first.id, { state: "waiting-user" }, a);
	expect((await summary(service)).summary.agents).toEqual([{ agentId: "a", blocked: 0, review: 0, waitingUser: 1 }]);
	store.update(first.id, { state: "active" }, a);
	expect((await summary(service)).summary.agents).toEqual([]);
	await publish(service, sourceA);
	expect((await summary(service)).sourceRevision).toBe(1); // Detail refresh is not a source switch.
	await publish(service, sourceB);
	expect(await summary(service)).toMatchObject({
		...envelope(2, "available"),
		summary: { agents: [{ agentId: "b", blocked: 0, review: 1, waitingUser: 0 }] },
	});
	store.done(second.id, "Verified", ["Review cleared"], b);
	expect((await summary(service)).summary.agents).toEqual([]);
	await publish(service, new URL("/invalid-token", sourceB).href);
	expect(await summary(service)).toEqual(envelope(3, "unavailable"));
	await service.stop();
	const restored = new CompanionService(uiDirectory, false);
	await restored.start();
	cleanups.push(() => restored.stop());
	expect(await summary(restored)).toEqual(envelope(0, "unpublished"));
});

test("source prefix/query and secret endpoint preserve existing board clients, while projecting only summary fields", async () => {
	const paths: string[] = [];
	const origin = await upstream((request, response) => {
		paths.push(request.url ?? "");
		response.setHeader("Content-Type", "application/json");
		response.end(
			JSON.stringify(
				request.url?.includes("view=activity")
					? { ...payload, title: "Do not proxy", agents: [{ ...payload.agents[0], body: "Private" }] }
					: { board: {}, text: "Existing board" },
			),
		);
	});
	const { service } = await companion();
	await publish(service, `${origin}/prefix/caller-token?other=kept&id=old`);
	expect(await summary(service)).toEqual({ ...envelope(1, "available"), summary: payload });
	expect(paths[0]).toBe("/prefix/caller-token?other=kept&view=activity");
	const existing = await (await fetch(`${service.url}board?id=detail`)).json();
	expect(existing).toEqual({ board: {}, text: "Existing board" });
	expect(paths[1]).toBe("/prefix/caller-token?other=kept&id=detail");
});

test("switching sources invalidates a slow body and old requests cannot restore old counts", async () => {
	let release!: () => void;
	let requested!: () => void;
	const received = new Promise<void>((resolve) => {
		requested = resolve;
	});
	const slow = await upstream((_request, response) => {
		response.writeHead(200, { "Content-Type": "application/json" });
		response.write('{"schemaVersion":1,');
		release = () => response.end(JSON.stringify(payload).slice('{"schemaVersion":1,'.length));
		requested();
	});
	const fresh = await upstream((_request, response) => response.end(JSON.stringify({ ...payload, agents: [] })));
	const { service } = await companion();
	await publish(service, `${slow}/slow`);
	const pending = summary(service);
	await received;
	await publish(service, `${fresh}/fresh`);
	const current = await summary(service);
	expect(current).toEqual({ ...envelope(2, "available"), summary: { ...payload, agents: [] } });
	release();
	expect(await pending).toEqual(current);
	expect(await summary(service)).toEqual(current);
});

test("HTTP, malformed schema, redirect and network failure never reuse previous counts", async () => {
	let mode = "ok";
	const origin = await upstream((_request, response) => {
		if (mode === "http") response.writeHead(503).end("Sensitive upstream error");
		else if (mode === "redirect") response.writeHead(302, { Location: "/redirected" }).end();
		else if (mode === "json") response.end("not json");
		else if (mode === "schema")
			response.end(JSON.stringify({ ...payload, agents: [{ agentId: "protocol", blocked: -1 }] }));
		else if (mode === "network") response.destroy();
		else response.end(JSON.stringify(payload));
	});
	const { service } = await companion();
	await publish(service, `${origin}/caller`);
	expect((await summary(service)).availability).toBe("available");
	for (mode of ["http", "redirect", "json", "schema", "network"])
		expect(await summary(service)).toEqual(envelope(1, "unavailable"));
	mode = "ok";
	expect((await summary(service)).availability).toBe("available");
});

test("a real five-second timeout returns unavailable, and stop aborts in-flight requests and removes endpoints", async () => {
	let requested!: () => void;
	let received = new Promise<void>((resolve) => {
		requested = resolve;
	});
	let closed = Promise.resolve();
	const origin = await upstream((_request, response) => {
		closed = new Promise<void>((resolve) => response.once("close", resolve));
		requested();
	});
	const { service, directory } = await companion();
	await publish(service, `${origin}/no-response`);
	const started = Date.now();
	expect(await summary(service)).toEqual(envelope(1, "unavailable"));
	expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
	received = new Promise<void>((resolve) => {
		requested = resolve;
	});
	const url = service.url;
	const pending = fetch(`${url}activity-summary`).then(
		() => "closed",
		() => "closed",
	);
	await received;
	const stopping = Date.now();
	await service.stop();
	await pending;
	await closed; // Upstream transport, not just the companion client, was aborted.
	expect(Date.now() - stopping).toBeLessThan(1000);
	await expect(fetch(`${url}activity-summary`)).rejects.toThrow();
	await expect(readFile(join(directory, "desktop.json"))).rejects.toMatchObject({ code: "ENOENT" });
	await service.start();
	expect(await summary(service)).toEqual(envelope(2, "unpublished"));
}, 10000);
