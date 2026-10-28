import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLinuxGuestProvider } from "../../src/backends/linux.js";
import { desktopEntry, linuxApps } from "../../src/backends/linux-apps.js";
import { runProcess } from "../../src/backends/process.js";

const deviceId = randomUUID();
const provider = createLinuxGuestProvider(deviceId, "execution-only");
const saved = { home: process.env.XDG_DATA_HOME, dirs: process.env.XDG_DATA_DIRS };
afterEach(() => {
	if (saved.home === undefined) delete process.env.XDG_DATA_HOME;
	else process.env.XDG_DATA_HOME = saved.home;
	if (saved.dirs === undefined) delete process.env.XDG_DATA_DIRS;
	else process.env.XDG_DATA_DIRS = saved.dirs;
});

describe("Linux guest provider boundary", () => {
	it("rejects extra fields, shell shaped app names and unbounded input before dispatch", () => {
		expect(provider.actions["computer.open"]?.validate({ appId: "org.example.Editor.desktop" })).toBe(true);
		expect(provider.actions["computer.open"]?.validate({ appId: "foo;touch /tmp/x.desktop" })).toBe(false);
		expect(provider.actions["computer.click"]?.validate({ x: 1, y: 2, command: "whoami" })).toBe(false);
		expect(provider.actions["computer.click"]?.validate({ x: -1, y: 2 })).toBe(false);
		expect(provider.actions["computer.type"]?.validate({ text: "a\0b" })).toBe(false);
		expect(provider.actions["computer.scroll"]?.validate({ direction: "down", pixels: 10001 })).toBe(false);
		expect(provider.actions["computer.back"]?.validate({})).toBe(true);
		expect(provider.actions["computer.back"]?.validate({ key: "Alt+F4" })).toBe(false);
	});
	it("refuses a different target and reports unavailable host capabilities honestly", async () => {
		await expect(provider.apps("android:host-bridge")).rejects.toThrow("WRONG_TARGET");
		const described = await provider.describe();
		expect(described.checkpointRestore).toBe("unsupported");
		expect(described.targets).toEqual([{ id: "linux:desktop", name: "Local Linux desktop" }]);
		if (process.platform !== "linux") {
			expect(described.capabilities.every((cap) => cap.state === "unsupported")).toBe(true);
			expect((await provider.apps("linux:desktop")).status).toBe("unsupported");
		}
	});
	// XDG launcher paths use POSIX path and colon semantics.
	it.skipIf(process.platform === "win32")(
		"reads installed launchers only and honors a hidden user override",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "w5-app-inventory-"));
			try {
				const user = join(root, "user", "applications");
				const system = join(root, "system", "applications");
				await mkdir(user, { recursive: true });
				await mkdir(system, { recursive: true });
				await writeFile(join(user, "masked.desktop"), "[Desktop Entry]\nType=Application\nHidden=true\n");
				await writeFile(
					join(system, "masked.desktop"),
					"[Desktop Entry]\nType=Application\nName=Masked\nExec=masked\n",
				);
				await writeFile(
					join(system, "editor.desktop"),
					"[Desktop Entry]\nType=Application\nName=Real Editor\nExec=editor\n[Desktop Action Fake]\nName=Not the app\n",
				);
				process.env.XDG_DATA_HOME = join(root, "user");
				process.env.XDG_DATA_DIRS = join(root, "system");
				const apps = await linuxApps(deviceId, "linux:desktop");
				expect(apps.items).toEqual([{ id: "editor.desktop", name: "Real Editor" }]);
				expect(apps.complete).toBe(true);
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		},
	);
	it("parses only the desktop entry section", () => {
		expect(desktopEntry("[Desktop Entry]\nType=Application\nName=A\\sB\n[Other]\nName=Wrong").Name).toBe("A B");
	});
	it("uses argv literally and waits for an aborted process to exit", async () => {
		const literal = "$(touch /tmp/never-executed)";
		const printed = await runProcess(process.execPath, ["-e", "process.stdout.write(process.argv[1])", literal]);
		expect(printed).toBe(literal);
		const controller = new AbortController();
		const pending = runProcess(process.execPath, ["-e", "setTimeout(() => process.stdout.write('late'), 10000)"], {
			signal: controller.signal,
		});
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		await expect(runProcess(process.execPath, ["-e", "process.exit(4)"])).rejects.toThrow("code 4");
	});
	it("kills the owned process group before an aborted action settles", async () => {
		if (process.platform === "win32") return;
		const root = await mkdtemp(join(tmpdir(), "w5-abort-"));
		const marker = join(root, "late");
		try {
			const controller = new AbortController();
			const pending = runProcess(
				process.execPath,
				[
					"-e",
					"require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => require(\"node:fs\").writeFileSync(process.argv[1], \"late\"), 800)', process.argv[1]], {stdio:'ignore'}); setInterval(()=>{},1000)",
					marker,
				],
				{ signal: controller.signal },
			);
			await new Promise((resolve) => setTimeout(resolve, 150));
			controller.abort();
			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
			await new Promise((resolve) => setTimeout(resolve, 900));
			await expect(access(marker)).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
