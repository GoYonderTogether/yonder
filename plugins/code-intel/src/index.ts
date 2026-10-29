import { definePlugin, executionContext, type Tool, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { astGrepReplace } from "./ast-grep-replace.js";
import { astGrepSearch } from "./ast-grep-search.js";
import { diagnosticMark, sessionDiagnostics } from "./diagnostic-mark.js";
import { effectiveConfig } from "./effective-config.js";
import { startLens, stopLens } from "./lens-mcp.js";
import { lspNavigation } from "./lsp-navigation.js";
import { moduleReport } from "./module-report.js";
import { outline } from "./outline.js";
import { projectReport } from "./project-report.js";
import { readEnclosing } from "./read-enclosing.js";
import { readSymbol } from "./read-symbol.js";
import { withResultContract } from "./result-contract.js";
import { symbolSearch } from "./symbol-search.js";

async function run(ctx: ToolContext, args: string[], cwd: string) {
	let stdout = "",
		stderr = "";
	const result = await ctx.env.exec(
		args,
		{
			cwd,
			timeout: 120,
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
			result.error.code === "spawn_error"
				? "CodeGraph unavailable in this environment; install @colbymchenry/codegraph 1.6.1."
				: result.error.message,
		);
	if (result.value.exitCode !== 0)
		throw new Error(`CodeGraph exited ${result.value.exitCode}: ${stderr.slice(-2000) || stdout.slice(-2000)}`);
	return stdout;
}

export default definePlugin({
	setup(api) {
		const register = (tool: Tool) => api.tools.register(withResultContract(tool));
		api.triggers.register({
			id: "code-intel-cleanup",
			async start() {
				startLens();
			},
			async stop() {
				await stopLens();
			},
		});
		register({
			name: "code-intel_module_report",
			description: "Outline a source file with symbols, callbacks and recommended reads using pi-lens.",
			parameters: Type.Object(
				{
					path: Type.String({ minLength: 1 }),
					focus: Type.Optional(Type.String()),
					view: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("summary"), Type.Literal("default")])),
					blastRadius: Type.Optional(Type.Boolean()),
					maxRefsPerSymbol: Type.Optional(
						Type.Number({ description: "Cap on who-uses-this entries per symbol (default 10)." }),
					),
					blastRadiusDepth: Type.Optional(
						Type.Number({ description: "Max hops for the blast-radius walk (default 3). Only used with blastRadius." }),
					),
					callGraph: Type.Optional(
						Type.Boolean({
							description:
								"Include bounded derived callers/callees from the cached FunctionCallGraph; cold or stale cache state is explicit.",
						}),
					),
					maxCallGraphEntries: Type.Optional(
						Type.Number({ description: "Per-direction cap for call-graph relations (default 20)." }),
					),
				},
				{ additionalProperties: false },
			),
			capabilities: ["read", "exec"],
			async execute(value, ctx) {
				const { path, ...args } = value as { path: string } & Record<string, unknown>;
				return moduleReport({ ...args, file: path }, ctx);
			},
		});
		register({
			name: "code-intel_codegraph_explore",
			description: "Find source symbols, files, and their call relationships with CodeGraph.",
			parameters: Type.Object(
				{
					query: Type.String({ minLength: 1 }),
					maxFiles: Type.Optional(Type.Integer({ minimum: 1 })),
					projectPath: Type.Optional(Type.String({ minLength: 1 })),
				},
				{ additionalProperties: false },
			),
			capabilities: ["read", "exec"],
			async execute(value, ctx) {
				const { query, maxFiles, projectPath } = value as { query: string; maxFiles?: number; projectPath?: string };
				const path = projectPath ?? ctx.env.cwd;
				const status = JSON.parse(await run(ctx, ["codegraph", "status", "--json", path], ctx.env.cwd)) as {
					initialized?: boolean;
					pendingChanges?: { added?: number; modified?: number; removed?: number };
					index?: { state?: string; reindexRecommended?: boolean };
				};
				if (!status.initialized)
					throw new Error(`CodeGraph index missing. Run codegraph init ${path} in this environment.`);
				if (
					status.index?.state !== "complete" ||
					status.index.reindexRecommended ||
					Object.values(status.pendingChanges ?? {}).some((n) => n > 0)
				)
					throw new Error(
						`CodeGraph index is stale. Run codegraph sync ${path} in this environment; if reindex is recommended, run codegraph index ${path}.`,
					);
				return {
					text: await run(
						ctx,
						["codegraph", "explore", "--path", path, "--max-files", String(maxFiles ?? 12), query],
						ctx.env.cwd,
					),
				};
			},
		});
		register(diagnosticMark);
		register(sessionDiagnostics(api.sessions));
		register(astGrepSearch);
		register(astGrepReplace);
		register(effectiveConfig);
		register(outline);
		register(readEnclosing);
		register(readSymbol);
		register(symbolSearch);
		register(projectReport);
		register(lspNavigation);
	},
});
