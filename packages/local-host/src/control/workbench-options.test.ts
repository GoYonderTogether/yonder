import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testModel } from "@yonder/local-host/config/test-support";
import { type HostCtx, registry, socketPrincipal } from "@yonder/local-host/control/methods";
import { initHome, openKernel } from "@yonder/local-host/kernel/index";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

test("owner options persist, child cannot expand resources/permissions, uploaded bytes survive transcript projection", async () => {
	const home = await tempHome("ya-workbench-");
	await initHome(home, "owner", { model: testModel });
	await writeFile(
		join(home, "presets/default.yaml"),
		`schema: 1\ndescription: 工作任务\nlevel: bypass\nmodel: ${testModel}\n`,
	);
	const root = join(home, "selected"),
		other = join(home, "other");
	await mkdir(root);
	await mkdir(other);
	const kernel = await openKernel(home);
	const ctx = { home, kernel, principal: socketPrincipal } as HostCtx;
	const signal = new AbortController().signal;
	const call = (method: string, params: unknown) => registry.call(method, params, ctx, signal);
	try {
		const parent = await kernel.workbench.open(
			{ preset: "default", close: "manual" },
			{ permission: "readonly", resources: [{ deviceId: "local", paths: [root] }] },
			signal,
		);
		const child = await kernel.workbench.open(
			{ preset: "default", close: "manual", parent: parent.id },
			{ permission: "bypass", resources: [] },
			signal,
		);
		const value = await kernel.workbench.get(child.id);
		expect(value.capabilities).not.toContain("exec");
		expect(value.resources[0]?.paths[0]).toContain("selected");
		await expect(
			kernel.workbench.set(child.id, { resources: [{ deviceId: "local", paths: [other] }] }, signal),
		).rejects.toThrow("outside");
		await expect(
			registry.call(
				"sessions.options.set",
				{ id: parent.id, permission: "bypass" },
				{ ...ctx, principal: { id: "guest", transport: "gateway", kind: "remote", scopes: ["read", "write"] } },
				signal,
			),
		).rejects.toThrow();
		const attachment = (await call("attachments.put", {
			name: "actual-package.json",
			dataBase64: (await readFile(join(process.cwd(), "package.json"))).toString("base64"),
		})) as { uri: string; bytes: number; kind: string; mime: string };
		expect(await readFile(new URL(attachment.uri), "utf8")).toContain('"name": "yonder"');
		await expect(call("attachments.get", { session: parent.id, uri: attachment.uri })).rejects.toThrow("not part");
		await call("sessions.submit", { id: parent.id, text: "", attachments: [attachment] });
		await expect
			.poll(
				async () =>
					(await kernel.sessions.transcript(parent.id)).some((item) =>
						item.attachments?.some((file) => file.uri === attachment.uri),
					),
				{ timeout: 5000 },
			)
			.toBe(true);
		const downloaded = (await call("attachments.get", { session: parent.id, uri: attachment.uri })) as {
			dataBase64: string;
		};
		expect(Buffer.from(downloaded.dataBase64, "base64")).toEqual(await readFile(new URL(attachment.uri)));
		await expect(call("attachments.get", { session: child.id, uri: attachment.uri })).rejects.toThrow("not part");
		await expect(call("attachments.put", { name: "bad", dataBase64: "@invalid" })).rejects.toThrow();
		expect(await call("workspaces.list", { id: child.id })).toMatchObject({
			devices: [{ deviceId: "local", paths: value.resources[0]?.paths }],
		});
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("a remote resource without a loaded devices plugin reports a real reason instead of silently hiding tools", async () => {
	const home = await tempHome("ya-workbench-remote-");
	const configured = {
		schema: 1 as const,
		agents: [],
		plugins: [
			{ use: "@yonder/plugin-devices", config: { cloud: { baseUrl: "https://example.test", credential: "card" } } },
		],
	};
	const { createWorkbenchOptions } = await import("@yonder/local-host/kernel/workbench-options");
	const runtime = () => ({ hasPendingWork: async () => false });
	const sessions = { get: async () => ({ id: "session", closed: false }) } as never;
	try {
		// Not loaded: the plugin is configured but its module never registered tools.
		const missing = createWorkbenchOptions(home, configured as never, runtime as never, sessions, () => [], new Map());
		await expect(
			missing.set(
				"session",
				{ resources: [{ deviceId: "00000000-0000-4000-8000-000000000001", paths: [] }] },
				new AbortController().signal,
			),
		).rejects.toThrow(/devices plugin/);
		// Loaded: the check passes and the caller continues with the real resource validation.
		const loaded = createWorkbenchOptions(
			home,
			configured as never,
			runtime as never,
			sessions,
			() => [],
			new Map([["devices", []]]),
		);
		await expect(
			loaded.set(
				"session",
				{ resources: [{ deviceId: "00000000-0000-4000-8000-000000000001", paths: [] }] },
				new AbortController().signal,
			),
		).rejects.not.toThrow(/devices plugin/);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
