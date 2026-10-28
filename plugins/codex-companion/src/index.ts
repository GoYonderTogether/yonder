import { definePlugin, executionContext, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";

async function run(ctx: ToolContext, args: string[], env?: Record<string, string>) {
	let stdout = "";
	let stderr = "";
	const result = await ctx.env.exec(
		args,
		{
			cwd: ctx.env.cwd,
			...(env ? { env, inheritEnv: false } : {}),
			onOutput: (chunk, _context, info) => {
				if (info.stream === "stdout") stdout += chunk;
				else stderr += chunk;
			},
		},
		executionContext(ctx.signal),
	);
	ctx.signal.throwIfAborted();
	if (!result.ok)
		throw new Error(
			result.error.code === "spawn_error" && args[0] === "codex"
				? "Codex CLI unavailable; install @openai/codex in the execution environment."
				: result.error.message,
		);
	return { ...result.value, stdout, stderr };
}

export default definePlugin({
	setup(api) {
		api.tools.register({
			name: "codex-companion_review",
			description: "Run Codex native review of the working tree or branch; report its output without making changes.",
			parameters: Type.Object(
				{
					codexHome: Type.String({ minLength: 1, description: "Explicit Codex home containing the authorized login." }),
					scope: Type.Optional(
						Type.Union([Type.Literal("auto"), Type.Literal("working-tree"), Type.Literal("branch")]),
					),
					base: Type.Optional(Type.String({ minLength: 1 })),
				},
				{ additionalProperties: false },
			),
			capabilities: ["read", "exec"],
			async execute(value, ctx) {
				const {
					codexHome,
					scope = "auto",
					base,
				} = value as { codexHome: string; scope?: "auto" | "working-tree" | "branch"; base?: string };
				if (!codexHome?.startsWith("/")) throw new Error("Provide an absolute authorized codexHome.");
				if (base?.startsWith("-")) throw new Error("Invalid base ref.");
				const isolation = await run(ctx, [
					"sh",
					"-c",
					`target=$(cd "$1" && pwd -P) || exit 1
personal=$(cd "$HOME/.codex" 2>/dev/null && pwd -P)
configured=$(test -n "$CODEX_HOME" && cd "$CODEX_HOME" 2>/dev/null && pwd -P)
for forbidden in "$personal" "$configured"; do
  test -z "$forbidden" && continue
  case "$target/" in "$forbidden/"*) exit 1;; esac
done`,
					"sh",
					codexHome,
				]);
				if (isolation.exitCode !== 0)
					throw new Error("codexHome must exist and must not be the default personal Codex home.");
				const path = await run(ctx, ["printenv", "PATH"]);
				if (path.exitCode !== 0) throw new Error("Execution environment PATH is unavailable.");
				const status = await run(ctx, ["git", "status", "--short", "--untracked-files=all"]);
				if (status.exitCode !== 0) throw new Error("Review requires a Git repository.");
				let branch = base;
				if (!branch && (scope === "branch" || (scope === "auto" && !status.stdout.trim()))) {
					const remote = await run(ctx, ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
					if (remote.exitCode === 0) branch = remote.stdout.trim().replace(/^origin\//, "");
					else {
						for (const candidate of ["main", "master", "trunk", "origin/main", "origin/master", "origin/trunk"]) {
							if (
								(await run(ctx, ["git", "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`])).exitCode === 0
							) {
								branch = candidate;
								break;
							}
						}
					}
					if (!branch) throw new Error("Unable to detect the default branch; provide base or use working-tree scope.");
				}
				if (branch) {
					const diff = await run(ctx, ["git", "diff", "--quiet", `${branch}...HEAD`, "--"]);
					if (diff.exitCode === 0) return { text: "Nothing to review: branch diff is empty." };
					if (diff.exitCode !== 1) throw new Error("Unable to compare the requested base branch.");
				} else if (!status.stdout.trim()) return { text: "Nothing to review: working tree is clean." };
				const result = await run(
					ctx,
					[
						"codex",
						"review",
						"-c",
						'sandbox_mode="read-only"',
						"-c",
						'approval_policy="never"',
						...(branch ? ["--base", branch] : ["--uncommitted"]),
					],
					{ CODEX_HOME: codexHome, HOME: codexHome, PATH: path.stdout.trim() },
				);
				if (result.exitCode !== 0)
					throw new Error("Codex review failed; check the authorized login and Codex CLI configuration.");
				const output = result.stdout || result.stderr;
				if (Buffer.byteLength(output) <= 30_000) return { text: output };
				const ref = await ctx.cacheToolOutput?.(output);
				return {
					text: `${output.slice(0, 30_000)}\n[Output truncated; ${ref ? `full output: ${ref}` : "cache unavailable"}]`,
				};
			},
		});
	},
});
