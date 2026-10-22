import { launchTerminalLogin } from "./login-terminal.js";
import { createLoginWrapper } from "./login-wrapper.js";

type Finish = (outcome: "succeeded" | "failed" | "interrupted" | "cancelled", code: number) => Promise<boolean>;
export function createLoginHostAdapter(options: {
	home: string;
	nodeExecutable: string;
	cliEntry: string;
	json: boolean;
	output: (value: unknown, json: boolean) => void;
	launch?: (path: string) => Promise<void>;
}) {
	return {
		start: async (input: { id: string; capability: string; provider: string; finish: Finish }) => {
			const { wrapperPath, resultPath } = await createLoginWrapper({
				nodeExecutable: options.nodeExecutable,
				cliEntry: options.cliEntry,
				home: options.home,
				provider: input.provider,
			});
			void launchTerminalLogin({
				wrapperPath,
				resultPath,
				timeoutMs: 10 * 60_000,
				...(options.launch ? { launch: options.launch } : {}),
				finish: async (result) => {
					const outcome = result.status === "complete" ? (result.code === 0 ? "succeeded" : "failed") : "failed";
					await input.finish(
						outcome,
						result.status === "complete" ? result.code : result.status === "timeout" ? 124 : 1,
					);
				},
				onFinishError: () =>
					options.output(
						{
							ts: new Date().toISOString(),
							level: "error",
							message: "Login completion persistence failed; operation remains pending",
						},
						options.json,
					),
			}).catch(() =>
				options.output(
					{
						ts: new Date().toISOString(),
						level: "error",
						message: "Login terminal monitor failed; operation remains pending",
					},
					options.json,
				),
			);
		},
	};
}
