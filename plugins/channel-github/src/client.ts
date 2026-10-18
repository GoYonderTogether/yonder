import { spawn } from "node:child_process";

export type ObjectValue = Record<string, unknown>;
export function object(value: unknown): ObjectValue {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub returned an invalid object");
 return value as ObjectValue;
}
export function nativeId(value: unknown): string {
 if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
 if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
 throw new Error("GitHub omitted a valid native id");
}
export function login(value: unknown): string { return String(object(value).login ?? "").toLowerCase(); }

// Fixed argv, no shell and no auth-token extraction. gh owns browser login and keychain access.
export async function command(args: string[], signal: AbortSignal, input?: object): Promise<string> {
 signal.throwIfAborted();
 return new Promise((resolve, reject) => {
  const child = spawn("agent-network", ["run", "--", "gh", ...args], {
   stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
  });
  let stdout = "", stderr = "", failure: Error | undefined;
  const stop = () => { failure ??= new Error("GitHub request cancelled; a mutation may already have taken effect. Query before retrying."); child.kill("SIGTERM"); };
  const timer = setTimeout(() => { failure = new Error("GitHub request exceeded 30000ms; mutation outcome may be unknown"); child.kill("SIGTERM"); }, 30_000);
  let kill: ReturnType<typeof setTimeout> | undefined;
  child.once("spawn", () => { if (signal.aborted) stop(); });
  child.once("error", error => { failure = error; });
  signal.addEventListener("abort", stop, { once: true });
  for (const [stream, target] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) {
   stream.on("data", (chunk: Buffer) => {
    if (target === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    if (stdout.length + stderr.length > 8_000_000) { failure = new Error("GitHub response exceeds 8MB; narrow the request"); child.kill("SIGTERM"); }
   });
  }
  child.once("exit", () => { clearTimeout(kill); });
  const originalKill = child.kill.bind(child);
  child.kill = ((...args: Parameters<typeof child.kill>) => {
   kill ??= setTimeout(() => originalKill("SIGKILL"), 2_000);
   return originalKill(...args);
  }) as typeof child.kill;
  child.stdin.on("error", () => {});
  child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  child.once("close", code => {
   clearTimeout(timer); clearTimeout(kill); signal.removeEventListener("abort", stop);
   if (failure) reject(failure);
   else if (code !== 0) reject(new Error(`gh failed (${code}): ${stderr.slice(0, 2000) || "No diagnostic; check gh installation/login and agent-network"}`));
   else resolve(stdout);
  });
 });
}
export class Github {
 constructor(readonly repo: string) {}
 async get(path: string, signal: AbortSignal): Promise<unknown> {
  return JSON.parse(await command(["api", "--hostname", "github.com", "--method", "GET", path, "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"], signal));
 }
 async write(path: string, data: object, signal: AbortSignal): Promise<ObjectValue> {
  return object(JSON.parse(await command(["api", "--hostname", "github.com", "--method", "POST", path, "--input", "-", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28"], signal, data)));
 }
 path(suffix: string): string { return `repos/${this.repo}/${suffix}`; }
 async *pages(suffix: string, signal: AbortSignal): AsyncGenerator<ObjectValue[]> {
  // REST page numbers are local traversal, never persisted as a delivery cursor.
  for (let page = 1; ; page++) {
   const result = await this.get(`${this.path(suffix)}${suffix.includes("?") ? "&" : "?"}per_page=100&page=${page}`, signal);
   if (!Array.isArray(result)) throw new Error("GitHub list did not return an array");
   yield result.map(object);
   if (result.length < 100) return;
  }
 }
 async list(suffix: string, signal: AbortSignal): Promise<ObjectValue[]> {
  const all: ObjectValue[] = [];
  for await (const page of this.pages(suffix, signal)) all.push(...page);
  return all;
 }
}
