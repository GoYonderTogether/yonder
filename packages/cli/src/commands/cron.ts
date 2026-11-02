import { readFile } from "node:fs/promises";
import { requestControl } from "@yonder/core";
import { type Options, optionalHome, output, UsageError } from "./context.js";

export const cronUsage =
	"Usage: yonder cron list | get|history|enable|disable|delete|run <id> | update <id> --file <json> | create --file <json>";

export async function runCron(command: string, options: Options, rest: string[]): Promise<number | undefined> {
	if (command !== "cron") return undefined;
	const [action, id, flag, file, ...extra] = rest;
	if (
		!action ||
		!["list", "get", "history", "enable", "disable", "delete", "run", "update", "create"].includes(action) ||
		(action === "list"
			? rest.length !== 1
			: action === "create"
				? id !== "--file" || !flag || rest.length !== 3
				: !id || (action === "update" ? flag !== "--file" || !file || extra.length !== 0 : rest.length !== 2))
	)
		throw new UsageError(cronUsage);
	const input =
		action === "create"
			? { ...JSON.parse(await readFile(flag!, "utf8")), action }
			: { action, ...(id ? { id } : {}), ...(file ? { job: JSON.parse(await readFile(file, "utf8")) } : {}) };
	const result = (await requestControl(optionalHome(options)!, {
		method: "views.act",
		params: { viewId: "cron.manage", action: "manage", input },
	})) as { content?: { text?: string } };
	if (!result.content?.text) throw new Error("Cron management returned no result");
	output(JSON.parse(result.content.text), options.json);
	return 0;
}
