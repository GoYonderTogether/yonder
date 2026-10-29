import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { describeVerificationFailure, serviceLogTail, verificationMismatch } from "./verify.js";

const commit = "a".repeat(40);
const install = "/Users/x/.local/share/yonder/install";
const home = "/Users/x/.yonder";
const directory = join(install, "versions", "0.3.26102802");
const facts = () => ({
	version: "0.3.26102802",
	home,
	install,
	repository: "https://github.com/GoYonderTogether/yonder.git",
	origin: { tag: "v0.3.26102802", commit, repository: "https://github.com/GoYonderTogether/yonder-harness" },
	service: { version: "0.3.26102802", commit, home, pid: 42, ready: true },
	status: { loaded: true, pid: 42, install, home },
	current: directory,
	directory,
});

test("a receipt is verified only when the service agrees with every recorded fact", () => {
	expect(verificationMismatch(facts())).toBeUndefined();
});

test("each mismatch names the fact that did not match", () => {
	const { service, status, origin } = facts();
	expect(verificationMismatch({ ...facts(), service: undefined })).toBe("the service did not answer service.info");
	expect(verificationMismatch({ ...facts(), service: { ...service, ready: false } })).toContain("is not ready yet");
	expect(verificationMismatch({ ...facts(), service: { ...service, version: "0.3.26102801" } })).toBe(
		"the running service reports version 0.3.26102801, the update installed 0.3.26102802",
	);
	expect(verificationMismatch({ ...facts(), service: { ...service, commit: "b".repeat(40) } })).toContain(
		"reports commit bbbbbbb",
	);
	expect(verificationMismatch({ ...facts(), service: { ...service, home: "/Users/x/other" } })).toContain(
		`expected ${home}`,
	);
	expect(verificationMismatch({ ...facts(), service: { ...service, pid: 0 } })).toBe(
		"the service did not report a positive pid",
	);
	expect(verificationMismatch({ ...facts(), status: undefined })).toBe("service status is unavailable");
	expect(verificationMismatch({ ...facts(), status: { ...status, loaded: false } })).toBe(
		"launchd does not show the installed service as loaded",
	);
	expect(verificationMismatch({ ...facts(), status: { ...status, pid: 7 } })).toContain("launchd tracks pid 7");
	expect(verificationMismatch({ ...facts(), status: { ...status, install: "/tmp/old" } })).toContain(
		`expected ${install}`,
	);
	expect(verificationMismatch({ ...facts(), status: { ...status, home: "/Users/x/other" } })).toContain(
		"launchd home is /Users/x/other",
	);
	expect(verificationMismatch({ ...facts(), origin: { ...origin, tag: "v0.3.26102801" } })).toBe(
		"the install record is tagged v0.3.26102801, expected v0.3.26102802",
	);
	expect(
		verificationMismatch({ ...facts(), service: { ...service, commit: "abc" }, origin: { ...origin, commit: "abc" } }),
	).toBe("the install record commit abc is not a 40-character SHA");
	expect(
		verificationMismatch({ ...facts(), origin: { ...origin, repository: "https://example.com/other" } }),
	).toContain("install record repository does not match");
	expect(verificationMismatch({ ...facts(), current: "/tmp/elsewhere" })).toBe(
		`install/current points at /tmp/elsewhere, expected versions/0.3.26102802`,
	);
});

test("a command capability failure tells the operator what repairs it", () => {
	const text = describeVerificationFailure(
		"the service did not answer service.info: Service command capability is missing or invalid",
		undefined,
		home,
	);
	expect(text).toContain("started without its command capability (fd 4)");
	expect(text).toContain(`yonder service install --home ${home}`);
	expect(text).not.toContain("service log:");
});

test("a missing package failure points at the inconsistent build", () => {
	expect(
		describeVerificationFailure(
			"Cannot find package '@yonder/plugin-ui-companion' imported from /x/packages/core/dist/plugins/index.js",
		),
	).toContain("npm run build:clean");
});

test("the service log tail explains the crash, unless it carries a secret", () => {
	expect(describeVerificationFailure("the service is not ready", "Error: Cannot find package '@yonder/plugin'")).toBe(
		"the service is not ready; service log: Error: Cannot find package '@yonder/plugin'",
	);
	expect(describeVerificationFailure("the service is not ready", "auth token=abc123")).toBe("the service is not ready");
	expect(describeVerificationFailure("the service is not ready", "   ")).toBe("the service is not ready");
});

test("the service log tail keeps the last lines and never throws", async () => {
	const root = await mkdtemp(join(tmpdir(), "yonder-verify-"));
	try {
		expect(await serviceLogTail(root)).toBeUndefined();
		await mkdir(join(root, ".yonder/logs"), { recursive: true });
		await writeFile(join(root, ".yonder/logs/harness.log"), "start\nfirst\nsecond\nthird\nfourth\n");
		expect(await serviceLogTail(root)).toBe("second | third | fourth");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
