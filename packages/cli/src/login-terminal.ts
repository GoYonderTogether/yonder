import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export type LoginResult = { status: "complete"; code: number };
const MAX_RESULT_BYTES = 128;

export async function readLoginResult(path: string): Promise<LoginResult | undefined> {
	try {
		const info = await lstat(path);
		if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RESULT_BYTES) return undefined;
		const text = await readFile(path, "utf8");
		if (Buffer.byteLength(text) > MAX_RESULT_BYTES) return undefined;
		const value: unknown = JSON.parse(text);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
		const record = value as Record<string, unknown>;
		if (
			Object.keys(record).length !== 2 ||
			record.status !== "complete" ||
			!Number.isInteger(record.code) ||
			(record.code as number) < 0 ||
			(record.code as number) > 255
		)
			return undefined;
		return { status: "complete", code: record.code as number };
	} catch {
		return undefined;
	}
}

export type TerminalLoginInput = {
	wrapperPath: string;
	resultPath: string;
	timeoutMs: number;
	launch?: (wrapperPath: string) => Promise<void>;
	finish: (result: LoginResult | { status: "timeout" | "invalid" }) => void;
};

export async function launchTerminalLogin(input: TerminalLoginInput): Promise<void> {
	const launch =
		input.launch ??
		((path: string) =>
			new Promise<void>((resolve, reject) => {
				const child = spawn("open", ["-a", "Terminal", path], { stdio: "ignore" });
				child.once("error", reject);
				child.once("close", (code) =>
					code === 0 ? resolve() : reject(new Error(`open failed (${code ?? "signal"})`)),
				);
			}));
	const interval = 200;
	const end = Date.now() + input.timeoutMs;
	let finished = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const finish = (result: LoginResult | { status: "timeout" | "invalid" }) => {
		if (finished) return;
		finished = true;
		if (timer) clearTimeout(timer);
		input.finish(result);
	};
	try {
		await launch(input.wrapperPath);
	} catch {
		finish({ status: "invalid" });
		return;
	}
	while (!finished && Date.now() < end) {
		const result = await readLoginResult(input.resultPath);
		if (result) {
			finish(result);
			return;
		}
		timer = setTimeout(() => {}, interval);
		await delay(interval);
		clearTimeout(timer);
		timer = undefined;
	}
	if (!finished) finish({ status: "timeout" });
}
