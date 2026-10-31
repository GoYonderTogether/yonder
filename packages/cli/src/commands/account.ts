import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import type { LoginInteraction } from "@yonder/core";
import {
	bundleIds,
	initHome,
	inspectHome,
	loginProvider,
	manageCredentialSlots,
	migrateCardVisitor,
	setNamedCredential,
} from "@yonder/core";
import { readHiddenCredential } from "../credential-input.js";
import { homeFor, loginMessage, type Options, output, print, UsageError } from "./context.js";

/** `init`, `credentials`, `login` and `doctor`. */
export async function runAccount(command: string, options: Options, rest: string[]): Promise<number | undefined> {
	if (command === "init") {
		const ownerIndex = rest.indexOf("--owner");
		const bundleIndex = rest.indexOf("--bundle");
		const modelIndex = rest.indexOf("--model");
		const model = modelIndex >= 0 ? rest[modelIndex + 1] : undefined;
		const isolated = rest.includes("--isolated");
		const owner = ownerIndex >= 0 ? rest[ownerIndex + 1] : "owner";
		const bundle = bundleIndex >= 0 ? rest[bundleIndex + 1] : undefined;
		const value = (index: number) =>
			(ownerIndex >= 0 && index === ownerIndex + 1) ||
			(bundleIndex >= 0 && index === bundleIndex + 1) ||
			(modelIndex >= 0 && index === modelIndex + 1);
		const target = rest.find((item, index) => !item.startsWith("-") && !value(index));
		if (ownerIndex >= 0 && (!owner || owner.startsWith("-"))) throw new UsageError("init --owner requires an id");
		if (bundleIndex >= 0 && (!bundle || bundle.startsWith("-"))) throw new UsageError("init --bundle requires an id");
		if (modelIndex >= 0 && (!model || model.startsWith("-"))) throw new UsageError("init --model requires provider/id");
		if (bundle !== undefined && !bundleIds.includes(bundle as (typeof bundleIds)[number]))
			throw new UsageError(`init --bundle accepts ${bundleIds.join(", ")}`);
		if (
			rest.some((item) => item.startsWith("-") && !["--owner", "--bundle", "--model", "--isolated"].includes(item)) ||
			rest.filter((item, index) => !item.startsWith("-") && !value(index)).length > 1
		)
			throw new UsageError(
				"Usage: yonder init [dir] [--owner <id>] [--bundle core|default|full] [--model <provider/id>] [--isolated]",
			);
		const home = homeFor(options, true, target);
		return print(
			initHome(home, owner, { isolated, ...(bundle ? { bundle } : {}), ...(model ? { model } : {}) }),
			options.json,
		);
	}
	if (command === "credentials" && rest[0] === "slots") {
		const action = rest[1];
		const provider = rest[2],
			slot = rest[3];
		const variable = rest[4] === "--env-ref" ? rest[5] : undefined;
		if (
			!action ||
			!["list", "status", "create", "remove"].includes(action) ||
			(action === "list"
				? rest.length !== 2
				: !provider || !slot || !(rest.length === 4 || (action === "create" && rest.length === 6 && variable)))
		)
			throw new UsageError(
				"Usage: yonder credentials slots list|status|create|remove [provider] [slot] [--env-ref <variable>]",
			);
		return print(
			manageCredentialSlots(
				homeFor(options),
				action as "list" | "status" | "create" | "remove",
				provider,
				slot,
				variable,
			),
			options.json,
		);
	}
	if (command === "credentials") {
		if (
			rest.length !== 2 ||
			rest[0] !== "set" ||
			!rest[1] ||
			!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(rest[1]) ||
			!options.home ||
			options.json
		)
			throw new UsageError("Usage: yonder credentials set <name> --home <dir> (local TTY only; no secret arguments)");
		const home = homeFor(options);
		stderr.write(`Home: ${home}\nNew credential: ${rest[1]} (existing names are never replaced)\n`);
		let secret = await readHiddenCredential();
		try {
			await setNamedCredential(home, rest[1], secret);
		} catch {
			throw new Error(
				"Credential not saved: invalid input, existing name, unsafe storage, or storage failure; inspect local permissions without printing credentials",
			);
		} finally {
			secret = "";
		}
		output({ name: rest[1], saved: true }, false);
		return 0;
	}
	if (command === "login") return login(options, rest);
	if (command !== "doctor") return undefined;
	if (rest.length > 1 || (rest.length === 1 && rest[0] !== "--fix"))
		throw new UsageError("Usage: yonder doctor [--fix]");
	if (rest[0] === "--fix") {
		const fixed = await migrateCardVisitor(homeFor(options));
		for (const item of fixed) stderr.write(`已补 ${item.agent} 的 card-visitor 绑定，备份 ${item.backup}\n`);
		if (!fixed.length) stderr.write("无需修复\n");
	}
	const result = await inspectHome(homeFor(options));
	if (options.json) output(result, true);
	else {
		output(result.ok ? "Doctor: passed" : "Doctor: issues found", false);
		output(
			"Static configuration check only; credential resolution, connection and message delivery require runtime verification.",
			false,
		);
		for (const issue of result.errors) stdout.write(`ERROR: ${issue}\n`);
		for (const warning of result.warnings) stdout.write(`WARNING: ${warning}\n`);
		for (const chain of result.modelChains ?? []) output({ modelChain: chain }, false);
	}
	return result.ok ? 0 : 1;
}

async function login(options: Options, rest: string[]): Promise<number> {
	const provider = rest[0];
	const loginOptions: { slot?: string; replace?: boolean; method?: "oauth" | "api_key" } = {};
	if (!provider || provider.startsWith("-"))
		throw new UsageError("Usage: yonder login <provider> [--slot <name>] [--method oauth|api_key] [--replace]");
	for (let i = 1; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === "--replace" && !loginOptions.replace) loginOptions.replace = true;
		else if (arg === "--slot" && !loginOptions.slot && rest[i + 1] && !rest[i + 1]?.startsWith("-"))
			loginOptions.slot = rest[++i] as string;
		else if (arg === "--method" && !loginOptions.method && ["oauth", "api_key"].includes(rest[i + 1] ?? ""))
			loginOptions.method = rest[++i] as "oauth" | "api_key";
		else throw new UsageError("Usage: yonder login <provider> [--slot <name>] [--method oauth|api_key] [--replace]");
	}
	if (!stdin.isTTY || !stderr.isTTY || options.json)
		throw new Error("Provider login requires a local interactive TTY; authorization details are never emitted as JSON");
	const home = homeFor(options);
	stderr.write(
		`Home: ${home}\nProvider: ${provider}; slot: ${loginOptions.slot ?? "default"}; ${loginOptions.replace ? "explicit replace" : "create only"}\n`,
	);
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	const interaction: LoginInteraction = {
		signal: controller.signal,
		async prompt(prompt) {
			stderr.write(`${prompt.message}\n`);
			const signal = prompt.signal ? AbortSignal.any([controller.signal, prompt.signal]) : controller.signal;
			signal.throwIfAborted();
			if (prompt.type === "secret" || prompt.type === "manual_code") return readHiddenCredential(signal);
			if (prompt.type === "select")
				for (const option of prompt.options) stderr.write(`${option.id}: ${option.label}\n`);
			const terminal = createInterface({ input: stdin, output: stderr });
			try {
				return await new Promise<string>((resolve, reject) => {
					const abort = () => {
						terminal.close();
						reject(new Error("Login cancelled"));
					};
					signal.addEventListener("abort", abort, { once: true });
					terminal.question("> ", (answer) => {
						signal.removeEventListener("abort", abort);
						if (prompt.type === "select" && !prompt.options.some((option) => option.id === answer))
							reject(new Error("Invalid authentication selection"));
						else resolve(answer);
					});
				});
			} finally {
				terminal.close();
			}
		},
		notify(event) {
			if (event.type === "auth_url") {
				stderr.write(`Yonder Harness sign-in: ${event.url}\n`);
				if (event.instructions) stderr.write(`${loginMessage(event.instructions)}\n`);
			} else if (event.type === "device_code")
				stderr.write(`Yonder Harness sign-in: ${event.verificationUri}\nCode: ${event.userCode}\n`);
			else {
				stderr.write(`${loginMessage(event.message)}\n`);
				if (event.type === "info")
					for (const link of event.links ?? []) stderr.write(`${link.label ? `${link.label}: ` : ""}${link.url}\n`);
			}
		},
	};
	try {
		await loginProvider(home, provider, interaction, loginOptions);
	} catch {
		throw new Error(
			"Login failed or cancelled; inspect slot status before retrying (existing or changed account, unsupported authentication, or provider/storage failure)",
		);
	} finally {
		process.removeListener("SIGINT", cancel);
	}
	output({ ok: true, provider, slot: loginOptions.slot ?? "default" }, options.json);
	return 0;
}
