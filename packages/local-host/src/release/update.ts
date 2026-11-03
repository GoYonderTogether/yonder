import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { requestControl } from "@yonder/local-host/control/index";
import { currentVersion, installRelease, type UpdateOptions } from "@yonder/local-host/release/install";

export type { UpdateOptions };

import { installedService } from "@yonder/local-host/release/installation";
import { installPath, manifest } from "@yonder/local-host/release/paths";
import { canonicalRepository } from "@yonder/local-host/release/repository";
import { recordUpdateResult, type UpdateResult } from "@yonder/local-host/release/result";
import { manageService } from "@yonder/local-host/release/service";
import { describeVerificationFailure, serviceLogTail, verificationMismatch } from "@yonder/local-host/release/verify";

/** One update at a time per install: a second caller fails fast instead of racing in the same temp directory. */
async function acquireUpdateLock(install: string): Promise<() => Promise<void>> {
	await mkdir(install, { recursive: true });
	const file = join(install, ".update.lock");
	for (let attempt = 0; ; attempt++) {
		try {
			await writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx", mode: 0o600 });
			return async () => {
				await rm(file, { force: true });
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let holder: { pid?: number; at?: number } = {};
			try {
				holder = JSON.parse(await readFile(file, "utf8"));
			} catch {}
			let alive = false;
			if (typeof holder.pid === "number") {
				try {
					process.kill(holder.pid, 0);
					alive = true;
				} catch {}
			}
			if (alive && Date.now() - (holder.at ?? 0) < 30 * 60_000)
				throw new Error(
					`Another update is already running (pid ${holder.pid}); wait for its result instead of starting a second one.`,
				);
			if (attempt > 0) throw new Error("Could not take the update lock");
			await rm(file, { force: true });
		}
	}
}

type ServiceFacts = NonNullable<UpdateResult["service"]>;
type ServiceSnapshot = Awaited<ReturnType<typeof manageService>>;
interface ReleaseSource {
	version: string;
	home: string;
	install: string;
	repository: string;
	origin: { tag?: string; commit?: string; repository?: string };
}

/** One read of the running release. Every fact comes from the service; nothing is inferred from disk. */
async function checkRunningRelease(input: ReleaseSource): Promise<{ service: ServiceFacts } | { reason: string }> {
	let service: ServiceFacts;
	try {
		service = (await requestControl(input.home, { method: "service.info" })) as ServiceFacts;
	} catch (error) {
		return {
			reason: `the service did not answer service.info: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	let status: ServiceSnapshot;
	try {
		status = await manageService("status");
	} catch (error) {
		return { reason: `service status failed: ${error instanceof Error ? error.message : String(error)}` };
	}
	let current: string | undefined, directory: string | undefined;
	try {
		current = await realpath(join(input.install, "current"));
		directory = await realpath(join(input.install, "versions", input.version));
	} catch {
		/* A missing or dangling link is one of the mismatches below. */
	}
	const reason = verificationMismatch({ ...input, service, status, current, directory });
	return reason ? { reason } : { service };
}

/** The 60 s self-check: the running service must answer with the release that was just installed. */
async function waitForRunningRelease(input: ReleaseSource) {
	const deadline = Date.now() + 60000;
	let last: { service: ServiceFacts } | { reason: string } = { reason: "Updated service is not ready" };
	do {
		last = await checkRunningRelease(input);
		if ("service" in last) return last;
		if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1000));
	} while (Date.now() < deadline);
	return last;
}

/** Shared by direct CLI updates and the existing service-external update job. */
export async function updateRelease(options: UpdateOptions = {}) {
	const release = await acquireUpdateLock(installPath());
	try {
		return await performUpdate(options);
	} finally {
		await release();
	}
}

/**
 * Re-check the installed release and record a fresh receipt without installing anything: the retry entry for a
 * failed-or-unknown self-check (09 §9). The facts still come from the running service and the receipt keeps the
 * version that is actually installed, so a re-check cannot claim work that did not happen.
 */
export async function verifyRelease(options: { home?: string; onProgress?: (message: string) => void } = {}) {
	const install = installPath(),
		registration = await installedService();
	const home = registration && resolve(registration.install) === install ? registration.home : options.home;
	if (!home) throw new Error("No installed service home to verify; install the service or pass --home <dir>");
	const version = await currentVersion(install);
	if (!version) throw new Error("No release is installed; run `yonder update --to <tag>` first");
	const directory = join(install, "versions", version);
	let origin: { commit: string; tag: string; repository: string };
	try {
		origin = JSON.parse(await readFile(join(directory, ".yonder-install.json"), "utf8")) as typeof origin;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		throw new Error(`Release ${version} has no install record; update again to install a verifiable release`);
	}
	const receipt: UpdateResult = {
		updateId: randomUUID(),
		install,
		home: resolve(home),
		repository: canonicalRepository(origin.repository),
		version,
		tag: origin.tag,
		commit: origin.commit,
		verified: false,
		status: "failed-or-unknown",
	};
	options.onProgress?.(`Verifying the installed release ${version} without installing it again.`);
	const checked = await waitForRunningRelease({
		version,
		home: receipt.home,
		install,
		repository: receipt.repository,
		origin,
	});
	if ("service" in checked) {
		receipt.service = checked.service;
		receipt.verified = true;
		receipt.status = "verified";
	} else receipt.error = describeVerificationFailure(checked.reason, await serviceLogTail(receipt.home), receipt.home);
	try {
		return { ...receipt, event: await recordUpdateResult(receipt) };
	} catch (error) {
		const eventError = error instanceof Error ? error.message : String(error);
		options.onProgress?.(`Verification result was not recorded: ${eventError}`);
		return { ...receipt, eventError };
	}
}

async function performUpdate(options: UpdateOptions) {
	const install = installPath(),
		registration = await installedService();
	const home = registration && resolve(registration.install) === install ? registration.home : options.home;
	const root = await manifest();
	let repository = options.repo ?? (typeof root.repository === "string" ? root.repository : root.repository?.url);
	if (!repository) throw new Error("Repository is not configured; pass --repo <url>");
	repository = canonicalRepository(repository);
	const beforeVersion = await currentVersion(install);
	const receipt: UpdateResult | undefined = home
		? {
				updateId: randomUUID(),
				install,
				home: resolve(home),
				repository,
				...(beforeVersion ? { beforeVersion } : {}),
				verified: false,
				status: "failed-or-unknown",
			}
		: undefined;
	const record = async () => {
		if (!receipt) return {};
		try {
			return { updateId: receipt.updateId, event: await recordUpdateResult(receipt) };
		} catch (error) {
			const eventError = error instanceof Error ? error.message : String(error);
			options.onProgress?.(
				`Update result was not recorded: ${eventError}; do not repeat installation to retry notification.`,
			);
			return { updateId: receipt.updateId, eventError };
		}
	};
	let result: Awaited<ReturnType<typeof installRelease>>;
	try {
		result = await installRelease(options);
	} catch (error) {
		if (receipt) {
			receipt.error = (error instanceof Error ? error.message : String(error)).replaceAll(
				options.repo ?? repository,
				repository,
			);
			await record();
		}
		throw error;
	}
	if (!result.updated || !receipt) return result;
	receipt.version = result.version;
	receipt.tag = `v${result.version}`;
	try {
		const directory = join(install, "versions", result.version);
		const origin = JSON.parse(await readFile(join(directory, ".yonder-install.json"), "utf8")) as {
			commit: string;
			tag: string;
			repository: string;
		};
		receipt.commit = origin.commit;
		if (
			("restartRequired" in result && result.restartRequired) ||
			!registration ||
			resolve(registration.install) !== install
		) {
			receipt.status = "restart-required";
		} else {
			const checked = await waitForRunningRelease({
				version: result.version,
				home: receipt.home,
				install,
				repository,
				origin,
			});
			if ("service" in checked) {
				receipt.service = checked.service;
				receipt.verified = true;
				receipt.status = "verified";
			} else
				receipt.error = describeVerificationFailure(checked.reason, await serviceLogTail(receipt.home), receipt.home);
		}
	} catch (error) {
		receipt.error = error instanceof Error ? error.message : String(error);
	}
	return { ...result, verified: receipt.verified, status: receipt.status, ...(await record()) };
}
