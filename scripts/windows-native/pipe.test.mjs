// Copyright 2026 Yonder contributors. Apache-2.0.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, Socket } from "node:net";
import { resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createPipeListener } from "../../packages/sdk/native/listener.mjs";

const binary = resolve(
	process.argv[2] ??
		fileURLToPath(new URL(`../../packages/sdk/native/win32-${process.arch}/owner-pipe.node`, import.meta.url)),
);
const native = createRequire(import.meta.url)(binary);
const listen = createPipeListener(native);
const endpoint = () => `\\\\.\\pipe\\yonder-owner-only-prototype-${randomUUID()}`;

test("accept HANDLE -> Node fd -> native Socket: concurrent, unicode, binary and repeat close", {
	timeout: 20000,
}, async () => {
	const path = endpoint();
	const server = listen(path, (socket) => {
		socket.on("error", () => {});
		socket.pipe(socket);
	});
	try {
		for (let round = 0; round < 5; round++) {
			await Promise.all(
				Array.from({ length: 8 }, async (_, i) => {
					const socket = createConnection(path);
					await once(socket, "connect");
					const payload = Buffer.concat([Buffer.from(`回合 ${round}/${i}\n`), Buffer.alloc(70000, i)]);
					const chunks = [];
					let received = 0;
					const echoed = new Promise((resolve, reject) => {
						socket.on("error", reject);
						socket.on("data", (chunk) => {
							chunks.push(chunk);
							received += chunk.length;
							if (received === payload.length) resolve(Buffer.concat(chunks));
						});
					});
					socket.write(payload);
					assert.deepEqual(await echoed, payload);
					const closed = once(socket, "close");
					socket.destroy();
					await closed;
				}),
			);
		}
		assert.equal(server.failure, undefined);
	} finally {
		await server.close();
		await server.close();
	}
});

test("close cancels pending accept and releases the namespace for restart", { timeout: 10000 }, async () => {
	const path = endpoint();
	for (let i = 0; i < 10; i++) {
		const server = listen(path, (socket) => socket.destroy());
		await server.close();
	}
});

test("first-instance collision fails instead of attaching to another server", async () => {
	const path = endpoint();
	const server = listen(path, (socket) => socket.destroy());
	try {
		assert.throws(() => listen(path, () => {}), /CreateNamedPipe/);
	} finally {
		await server.close();
	}
});

test("actual DACL is protected and grants only current SID and SYSTEM, including replacements", async () => {
	const sid = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" }).match(
		/S-1-\d+(?:-\d+)+/,
	)[0];
	const path = endpoint();
	const handle = native.create(path);
	const descriptor = native.describe(handle);
	assert.match(descriptor, /^D:P/);
	const aces = [...descriptor.matchAll(/\(A;;[^;]*;;;([^)]+)\)/g)].map((match) => match[1]);
	assert.deepEqual(aces.sort(), [sid, "SY"].sort());
	assert.equal((descriptor.match(/\(/g) ?? []).length, 2);
	console.log(JSON.stringify({ arch: process.arch, node: process.versions.node, descriptor }));
	try {
		// A client can open and close before ConnectNamedPipe is called.
		const abandoned = createConnection(path);
		await once(abandoned, "connect");
		const gone = once(abandoned, "close");
		abandoned.destroy();
		await gone;
		const accepted = native.accept(handle);
		const client = createConnection(path);
		await once(client, "connect");
		const fd = await accepted;
		assert.ok(fd > 2);
		const socket = new Socket({ fd, readable: true, writable: true });
		assert.equal(native.describe(handle), descriptor);
		const closed = once(socket, "close");
		socket.destroy();
		await closed;
		const clientClosed = client.closed ? Promise.resolve() : once(client, "close");
		client.destroy();
		await clientClosed;
	} finally {
		native.close(handle);
	}
});

test("callback failure destroys accepted sockets and close waits for every close event", async () => {
	const path = endpoint();
	let accepted;
	let closed = false;
	const server = listen(path, (socket) => {
		accepted = socket;
		socket.once("close", () => {
			closed = true;
		});
		throw new Error("intentional callback failure");
	});
	const client = createConnection(path);
	client.on("error", () => {});
	try {
		await once(client, "close");
		await assert.rejects(server.close(), /intentional callback failure/);
		assert.equal(accepted.destroyed, true);
		assert.equal(closed, true);
	} finally {
		client.destroy();
		await server.close().catch(() => {});
	}
});

test("idle listeners do not consume filesystem thread pool", { timeout: 10000 }, async () => {
	const servers = Array.from({ length: 8 }, () => listen(endpoint(), (socket) => socket.destroy()));
	try {
		assert.ok((await readFile(new URL(import.meta.url), "utf8")).length > 0);
	} finally {
		await Promise.all(servers.map((server) => server.close()));
	}
});

test("terminating Worker cancels native accept and releases the pipe name", { timeout: 10000 }, async () => {
	const path = endpoint();
	const worker = new Worker(
		`
    const { workerData, parentPort } = require('node:worker_threads');
    import(workerData.adapter).then(({ createPipeListener }) => {
      createPipeListener(require(workerData.binary))(workerData.path, socket => socket.destroy());
      parentPort.postMessage('ready');
    });`,
		{
			eval: true,
			workerData: { path, binary, adapter: new URL("../../packages/sdk/native/listener.mjs", import.meta.url).href },
		},
	);
	try {
		await once(worker, "message");
		await worker.terminate();
		const replacement = listen(path, (socket) => socket.destroy());
		await replacement.close();
	} finally {
		await worker.terminate();
	}
});

test("closed standard fds cannot become adopted Socket stdio fds", { timeout: 10000 }, async () => {
	const path = endpoint();
	const child = spawn(
		process.execPath,
		[
			"-e",
			`
    const { closeSync, writeSync } = require('node:fs');
    const [path, binary, adapter] = process.argv.slice(1);
    import(adapter).then(({ createPipeListener }) => {
      const native = require(binary);
      for (const fd of [0, 1, 2]) closeSync(fd);
      const server = createPipeListener(native)(path, socket => {
        socket.on('error', () => {});
        socket.on('data', data => socket.end(data));
        socket.on('close', () => server.close().then(() => writeSync(3, 'done')));
      });
      writeSync(3, 'ready');
    });`,
			path,
			binary,
			new URL("../../packages/sdk/native/listener.mjs", import.meta.url).href,
		],
		{ stdio: ["ignore", "ignore", "ignore", "pipe"] },
	);
	const exited = once(child, "exit");
	try {
		assert.equal(String((await once(child.stdio[3], "data"))[0]), "ready");
		const client = createConnection(path);
		await once(client, "connect");
		const data = once(client, "data");
		client.write("native low-fd echo");
		assert.equal(String((await data)[0]), "native low-fd echo");
		client.destroy();
		assert.equal((await exited)[0], 0);
	} finally {
		child.kill();
	}
});

test("repeated create, accept and close does not grow native HANDLE count", { timeout: 20000 }, async () => {
	async function round() {
		const path = endpoint();
		const server = listen(path, (socket) => socket.end("ready"));
		const client = createConnection(path);
		client.resume();
		await once(client, "close");
		await server.close();
		await sleep(0);
	}
	await round();
	const before = native.handleCount();
	for (let i = 0; i < 30; i++) await round();
	await sleep(50);
	const after = native.handleCount();
	assert.ok(after <= before + 2, `native HANDLEs grew: ${before} -> ${after}`);
});
