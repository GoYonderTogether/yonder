import { stderr, stdin } from "node:process";
import { emitKeypressEvents } from "node:readline";

/** No echo, history, pipe/env/argv fallback, or secret-bearing errors. */
export async function readHiddenCredential(signal?: AbortSignal): Promise<string> {
	signal?.throwIfAborted();
	if (!stdin.isTTY || !stderr.isTTY || typeof stdin.setRawMode !== "function")
		throw new Error("Credential entry requires a local interactive TTY");
	if (stdin.isRaw) throw new Error("Credential entry requires an idle terminal");
	emitKeypressEvents(stdin);
	return new Promise<string>((resolve, reject) => {
		let value = "";
		const cleanup = () => {
			signal?.removeEventListener("abort", cancel);
			stdin.removeListener("keypress", onKey);
			stdin.removeListener("end", cancel);
			stdin.removeListener("error", cancel);
			for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.removeListener(signal, cancel);
			stdin.setRawMode(false);
			stdin.pause();
			stderr.write("\n");
		};
		const cancel = () => {
			value = "";
			cleanup();
			reject(new Error("Credential entry cancelled; nothing saved"));
		};
		const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
			if (key.ctrl && ["c", "d", "z"].includes(key.name ?? "")) return cancel();
			if (key.name === "return" || key.name === "enter") {
				const result = value;
				value = "";
				cleanup();
				resolve(result);
			} else if (key.name === "backspace") value = Array.from(value).slice(0, -1).join("");
			else if (
				text &&
				!key.ctrl &&
				!key.meta &&
				Array.from(text).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
			)
				value += text;
		};
		signal?.addEventListener("abort", cancel, { once: true });
		stdin.setRawMode(true);
		stdin.on("keypress", onKey);
		stdin.once("end", cancel);
		stdin.once("error", cancel);
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, cancel);
		stderr.write("Secret (hidden; Ctrl-C cancels): ");
		stdin.resume();
	});
}
