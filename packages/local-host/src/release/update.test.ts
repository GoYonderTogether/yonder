import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requestControl: vi.fn(),
	manageService: vi.fn(),
	installedService: vi.fn(),
	recordUpdateResult: vi.fn(),
}));

vi.mock("@yonder/local-host/control/index", () => ({ requestControl: mocks.requestControl }));
vi.mock("@yonder/local-host/release/service", () => ({ manageService: mocks.manageService }));
vi.mock("@yonder/local-host/release/installation", () => ({ installedService: mocks.installedService }));
vi.mock("@yonder/local-host/release/result", () => ({ recordUpdateResult: mocks.recordUpdateResult }));

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyRelease } from "@yonder/local-host/release/update";

const version = "0.3.26110207";
const commit = "a".repeat(40);

async function installedFixture() {
	const root = await mkdtemp(join(tmpdir(), "yonder-update-verify-"));
	const install = join(root, "install");
	const home = join(root, "home");
	const directory = join(install, "versions", version);
	await mkdir(directory, { recursive: true });
	await mkdir(home, { recursive: true });
	await writeFile(
		join(directory, ".yonder-install.json"),
		JSON.stringify({
			version,
			tag: `v${version}`,
			commit,
			repository: "https://github.com/GoYonderTogether/yonder.git",
		}),
	);
	await symlink(directory, join(install, "current"), process.platform === "win32" ? "junction" : "dir");
	return { root, install, home };
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

test("release verification waits through a 37-second service startup", async () => {
	const fixture = await installedFixture();
	const previousInstall = process.env.YONDER_INSTALL;
	vi.stubEnv("YONDER_INSTALL", fixture.install);
	vi.useFakeTimers({ now: new Date("2026-11-02T10:00:00.000Z") });
	let beginPolling!: () => void;
	const polling = new Promise<void>((resolve) => (beginPolling = resolve));
	mocks.installedService.mockResolvedValue(undefined);
	mocks.manageService.mockResolvedValue({
		loaded: true,
		pid: 21468,
		install: fixture.install,
		home: fixture.home,
	});
	mocks.recordUpdateResult.mockResolvedValue("01M6DYH6FRQ30W5HG0GFE2YHZ6");
	mocks.requestControl.mockImplementation(async () => {
		beginPolling();
		if (Date.now() < new Date("2026-11-02T10:00:37.000Z").getTime()) {
			throw Object.assign(new Error("control socket not ready"), { code: "ENOENT" });
		}
		return {
			version,
			commit,
			home: fixture.home,
			pid: 21468,
			ready: true,
		};
	});
	try {
		const resultPromise = verifyRelease({ home: fixture.home });
		await polling;
		await vi.advanceTimersByTimeAsync(37_000);
		const result = await resultPromise;
		expect(result).toMatchObject({ status: "verified", verified: true, version, commit });
		expect(mocks.requestControl).toHaveBeenCalledTimes(38);
		expect(mocks.recordUpdateResult).toHaveBeenCalledWith(
			expect.objectContaining({ verified: true, status: "verified" }),
		);
	} finally {
		if (previousInstall === undefined) delete process.env.YONDER_INSTALL;
		else process.env.YONDER_INSTALL = previousInstall;
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("release verification still fails after the bounded 60-second startup window", async () => {
	const fixture = await installedFixture();
	const previousInstall = process.env.YONDER_INSTALL;
	vi.stubEnv("YONDER_INSTALL", fixture.install);
	vi.useFakeTimers({ now: new Date("2026-11-02T10:00:00.000Z") });
	let beginPolling!: () => void;
	const polling = new Promise<void>((resolve) => (beginPolling = resolve));
	mocks.installedService.mockResolvedValue(undefined);
	mocks.requestControl.mockImplementation(async () => {
		beginPolling();
		throw Object.assign(new Error("control socket not ready"), { code: "ENOENT" });
	});
	mocks.recordUpdateResult.mockResolvedValue("01M6DYH6FRQ30W5HG0GFE2YHZ6");
	try {
		const resultPromise = verifyRelease({ home: fixture.home });
		await polling;
		await vi.advanceTimersByTimeAsync(60_000);
		const result = await resultPromise;
		expect(result).toMatchObject({ status: "failed-or-unknown", verified: false, version, commit });
		expect(mocks.requestControl).toHaveBeenCalledTimes(60);
		expect(mocks.manageService).not.toHaveBeenCalled();
		expect(mocks.recordUpdateResult).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "failed-or-unknown",
				verified: false,
			}),
		);
	} finally {
		if (previousInstall === undefined) delete process.env.YONDER_INSTALL;
		else process.env.YONDER_INSTALL = previousInstall;
		await rm(fixture.root, { recursive: true, force: true });
	}
});
