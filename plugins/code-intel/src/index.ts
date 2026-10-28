import { definePlugin, executionContext, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
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
		api.triggers.register({
			id: "code-intel-cleanup",
			async start() {
				startLens();
			},
			async stop() {
				await stopLens();
			},
		});
		api.tools.register({
			name: "code-intel_module_report",
			description: "Outline a source file with symbols, callbacks and recommended reads using pi-lens.",
			parameters: Type.Object(
				{
					path: Type.String({ minLength: 1 }),
					focus: Type.Optional(Type.String()),
					view: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("summary"), Type.Literal("default")])),
					blastRadius: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: false },
			),
			capabilities: ["read", "exec"],
			async execute(value, ctx) {
				const { path, focus, view, blastRadius } = value as {
					path: string;
					focus?: string;
					view?: string;
					blastRadius?: boolean;
				};
				return moduleReport({ file: path, focus, view: view ?? "compact", blastRadius }, ctx);
			},
		});
		api.tools.register({
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
		api.tools.register(diagnosticMark);
		api.tools.register(sessionDiagnostics(api.sessions));
		api.tools.register(astGrepSearch);
		api.tools.register(effectiveConfig);
		api.tools.register(outline);
		api.tools.register(readEnclosing);
		api.tools.register(readSymbol);
		api.tools.register(projectReport);
		api.tools.register(symbolSearch);
		api.tools.register(lspNavigation);
	},
});
