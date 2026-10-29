import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalRepository } from "./repository.js";

/** The service facts a receipt must match; every field comes from the running service, never from disk. */
export interface VerificationFacts {
	/** Version the update installed. */
	version: string;
	/** Home the receipt names. */
	home: string;
	/** Install root the update wrote. */
	install: string;
	/** Canonical repository the receipt names. */
	repository: string;
	origin: { tag?: string; commit?: string; repository?: string };
	service?: { version?: string; commit?: string; home?: string; pid?: number; ready?: boolean } | undefined;
	status?: { loaded?: boolean; pid?: number | null; install?: string; home?: string } | undefined;
	current?: string | undefined;
	directory?: string | undefined;
}

const short = (commit: string | undefined) => (commit ? commit.slice(0, 7) : "unknown");

/**
 * The one acceptance rule for a verified receipt (09 §9), written as ordered mismatches so a failure can name the
 * fact that did not match instead of "not ready". `undefined` means every fact matched.
 */
export function verificationMismatch(facts: VerificationFacts): string | undefined {
	const { service, status, origin } = facts;
	if (!service) return "the service did not answer service.info";
	if (service.ready !== true) return `the service at pid ${service.pid ?? "unknown"} is not ready yet`;
	if (service.version !== facts.version)
		return `the running service reports version ${service.version ?? "unknown"}, the update installed ${facts.version}`;
	if (service.commit !== origin.commit)
		return `the running service reports commit ${short(service.commit)}, the update installed ${short(origin.commit)}`;
	if (service.home !== facts.home)
		return `the running service reports home ${service.home ?? "unknown"}, expected ${facts.home}`;
	if (!(typeof service.pid === "number" && service.pid > 0)) return "the service did not report a positive pid";
	if (!status) return "service status is unavailable";
	if (status.loaded !== true) return "launchd does not show the installed service as loaded";
	if (status.pid !== service.pid)
		return `launchd tracks pid ${status.pid ?? "none"} but the service answers as pid ${service.pid}`;
	if (status.install !== facts.install)
		return `launchd runs the service from ${status.install ?? "unknown"}, expected ${facts.install}`;
	if (status.home !== facts.home) return `launchd home is ${status.home ?? "unknown"}, expected ${facts.home}`;
	if (origin.tag !== `v${facts.version}`)
		return `the install record is tagged ${origin.tag ?? "none"}, expected v${facts.version}`;
	if (!/^[a-f0-9]{40}$/u.test(origin.commit ?? ""))
		return `the install record commit ${origin.commit ?? "none"} is not a 40-character SHA`;
	if (canonicalRepository(origin.repository ?? "") !== facts.repository)
		return `the install record repository does not match ${facts.repository}`;
	if (facts.current !== facts.directory)
		return `install/current points at ${facts.current ?? "nothing"}, expected versions/${facts.version}`;
	return undefined;
}

/** The command that repairs a service started without its helper-supplied command capability. */
export const serviceInstallHint = (home: string) => `yonder service install --home ${home} && yonder service restart`;

const SENSITIVE = /(password|passwd|secret|api[_-]?key|token|bearer|authorization)\s*[:=]/iu;
const CAPABILITY = /service command capability/iu;
const MISSING_PACKAGE = /cannot find package/iu;

/**
 * Turn a mismatch (or an exception text) into a receipt error that explains what to do next. The service log tail is
 * the only place the missing-package and command-capability crashes are visible, so it is appended when it is safe.
 */
export function describeVerificationFailure(reason: string, logTail?: string, home?: string): string {
	let text = reason;
	if (CAPABILITY.test(reason))
		text = `${reason}; the service was started without its command capability (fd 4)${
			home ? ` — reinstall it with \`${serviceInstallHint(home)}\`` : ""
		}`;
	else if (MISSING_PACKAGE.test(reason))
		text = `${reason}; that release was built from inconsistent sources — rebuild it with \`npm run build:clean\` and update again`;
	const tail = logTail?.trim();
	if (tail && !SENSITIVE.test(tail)) text = `${text}; service log: ${tail}`;
	return text;
}

/** Last lines of the hosted service log: the crash that kept the service from answering. Never throws. */
export async function serviceLogTail(home: string): Promise<string | undefined> {
	try {
		const text = await readFile(join(home, ".yonder/logs/harness.log"), "utf8");
		return (
			text
				.slice(-4000)
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				.slice(-3)
				.join(" | ")
				.slice(0, 300) || undefined
		);
	} catch {
		return undefined;
	}
}
