import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { manageService, requestControl } from "@yonder/local-host";
import { loginChannel } from "../channels-login.js";
import { applyMigration, defaultMigrateOptions, planMigration } from "../migrate.js";
import { formatMigration, rollbackMigration } from "../migrate-rollback.js";
import { uninstall } from "../uninstall.js";
import {
	channelsList,
	homeFor,
	type Options,
	optionalHome,
	output,
	print,
	releaseUsage,
	UsageError,
} from "./context.js";

/** `channels`, `migrate`, `uninstall` and `service`. */
export async function runChannels(command: string, options: Options, rest: string[]): Promise<number | undefined> {
	if (command === "channels") {
		const [action, ...values] = rest;
		if (action === "list" && !values.length) {
			if (!options.json) output("login: supports login operation, not online status", false);
			return print(channelsList(homeFor(options)), options.json);
		}
		if (action !== "login")
			throw new UsageError(
				"Usage: yonder channels list|login [instance] [--poll] [--verify-code <code>] [--open] [--replace]",
			);
		let instance: string | undefined,
			verifyCode: string | undefined,
			open = false,
			poll = false,
			replace = false;
		for (let index = 0; index < values.length; index++) {
			const value = values[index]!;
			if (value === "--open") open = true;
			else if (value === "--poll") poll = true;
			else if (value === "--replace") replace = true;
			else if (value === "--verify-code") {
				verifyCode = values[++index];
				if (!verifyCode || !/^\d{1,12}$/.test(verifyCode)) throw new UsageError("Invalid verification code");
				poll = true;
			} else if (!value.startsWith("-") && !instance) instance = value;
			else throw new UsageError("Invalid channels login option");
		}
		if (replace && poll) throw new UsageError("--replace must be used when starting channel login");
		if (replace && !instance) throw new UsageError("--replace requires a channel instance");
		// 服务没起来时 control.sock 的 ENOENT 由 loginChannel 翻成「先运行 yonder start」（JV2-J02-01）。
		const result = await loginChannel(homeFor(options), {
			...(instance ? { instance } : {}),
			action: poll ? "poll" : "start",
			...(verifyCode ? { verifyCode } : {}),
			...(replace ? { replace: true } : {}),
		});
		output(result, options.json);
		if (open && result.qrcodeUrl) {
			const url = new URL(result.qrcodeUrl);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new Error("Channel login only opens HTTPS links");
			await promisify(execFile)(process.platform === "darwin" ? "open" : "xdg-open", [url.href]);
		}
		return 0;
	}
	if (command === "migrate") {
		const migrateUsage =
			"Usage: yonder migrate [--dry-run | --apply] [--no-service] | --rollback <backup> [--dry-run] [--force]";
		const flagged = (name: string) => rest.includes(name);
		const rollbackAt = rest.indexOf("--rollback");
		const backup = rollbackAt >= 0 ? rest[rollbackAt + 1] : undefined;
		const migrateFlags = ["--dry-run", "--apply", "--no-service", "--rollback", "--force"];
		const isBackup = (index: number) => rollbackAt >= 0 && index === rollbackAt + 1;
		const stray = rest.filter((arg, index) => !migrateFlags.includes(arg) && !isBackup(index));
		if (
			stray.length ||
			(flagged("--force") && rollbackAt < 0) ||
			(flagged("--apply") && flagged("--dry-run")) ||
			(rollbackAt >= 0 && (!backup || backup.startsWith("-")))
		)
			throw new UsageError(migrateUsage);
		const defaults = defaultMigrateOptions();
		if (flagged("--no-service")) defaults.services = false;
		if (backup) {
			const result = await rollbackMigration(resolve(backup), {
				apply: !flagged("--dry-run"),
				force: flagged("--force"),
			});
			output(options.json ? result : result.lines.join("\n"), options.json);
			return 0;
		}
		if (!flagged("--apply")) {
			const plan = await planMigration(defaults);
			const text = [
				...plan.conflicts,
				...(plan.lines.length ? plan.lines : plan.conflicts.length ? [] : ["无需迁移 · Nothing to migrate"]),
				...(plan.status === "ready" ? ["（dry-run；加 --apply 执行）"] : []),
			].join("\n");
			output(options.json ? plan : text, options.json);
			return plan.status === "blocked" ? 1 : 0;
		}
		const result = await applyMigration(defaults);
		output(options.json ? result : formatMigration(result), options.json);
		return result.launchdErrors.length ? 1 : 0;
	}
	if (command === "uninstall") return uninstall(rest, options.json, optionalHome(options));
	if (command !== "service") return undefined;
	const action = rest[0];
	if (action === "info" && rest.length === 1)
		return print(requestControl(homeFor(options), { method: "service.info" }), options.json);
	if (rest.length !== 1 || !action || !["install", "uninstall", "start", "stop", "restart", "status"].includes(action))
		throw new UsageError(releaseUsage.service);
	return print(
		manageService(
			action as Parameters<typeof manageService>[0],
			action === "install" ? { home: homeFor(options) } : {},
		),
		options.json,
	);
}
