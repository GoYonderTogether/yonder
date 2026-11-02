import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { OutputPart, SessionUpdate, YEvent } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
for (const scenario of ["generation", "tools", "interrupt", "foreign-steer"] as const) {
	test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
		`real Luna preserves queued inputs across source groups during ${scenario}`,
		async () => {
			const home = await tempHome("yonder-input-queue-");
			let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
			const sockets: Socket[] = [];
			const updates: SessionUpdate[] = [];
			let stop: (() => Promise<void>) | undefined;
			const packets: Array<OutputPart | { type: "accepted"; event: YEvent }> = [];
			try {
				await initHome(home, "owner", { model: testModel });
				const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
				config.credentials = auth;
				config.channels.interrupt = { type: "cli" };
				config.identity.persons[0].accounts.push("acct:interrupt:local");
				await writeFile(`${home}/yonder.yaml`, stringify(config));
				const path = `${home}/agents/main/agent.yaml`;
				const agent = parse(await readFile(path, "utf8"));
				agent.defaults.contexts = [];
				agent.profiles.owner.model = "openai/gpt-6-luna";
				agent.profiles.owner.tools = { offer: scenario === "generation" ? [] : ["bash"], search: [] };
				const ownerBinding = agent.bindings.find((binding: { id: string }) => binding.id === "owner");
				if (!ownerBinding) throw new Error("Missing owner binding");
				delete ownerBinding.busy;
				ownerBinding.stream = true;
				agent.bindings.unshift({
					...ownerBinding,
					id: "interrupt",
					match: { channel: "interrupt", from: "owner" },
					busy: scenario === "interrupt" ? "interrupt" : "steer",
				});
				await writeFile(path, stringify(agent));
				kernel = await openKernel(home);
				const running = kernel;
				let onboarding: YEvent | undefined;
				await expect
					.poll(
						async () => {
							onboarding = (await running.events.query({ type: "onboarding.start", conv: "conv:onboarding:main" }))
								.events[0];
							return onboarding !== undefined;
						},
						{ timeout: 30000 },
					)
					.toBe(true);
				const onboardingId = onboarding?.id;
				if (!onboardingId) throw new Error("Missing onboarding start event");
				await expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", conv: "conv:onboarding:main" })).events.some((event) =>
								((event.data as { inputs?: string[] }).inputs ?? []).includes(onboardingId),
							),
						{ timeout: 180000 },
					)
					.toBe(true);
				const connect = async (channel: string) => {
					const socket = createConnection(`${home}/.yonder/plugins/channel-cli/${channel}.sock`);
					sockets.push(socket);
					createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
					await new Promise<void>((done, reject) => {
						socket.once("connect", done);
						socket.once("error", reject);
					});
					return socket;
				};
				const cli = await connect("cli");
				const interrupt = await connect("interrupt");
				const send = (socket: Socket, text: string) =>
					socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				send(
					cli,
					scenario === "generation"
						? "Input A. Without tools, write a very long detailed explanation of how event queues work, at least 2000 words. Start with QUEUE_OLD."
						: `Input A. Say QUEUE_PROGRESS, then call bash exactly once with command "sleep ${scenario === "interrupt" ? 25 : 3}; printf QUEUE_TOOL_DONE". Keep the tool in the foreground. After the tool, answer any further user inputs without calling another tool.`,
				);
				await expect.poll(() => packets.some((p) => p.type === "accepted"), { timeout: 5000 }).toBe(true);
				const accepted = packets.find((p) => p.type === "accepted");
				if (accepted?.type !== "accepted") throw new Error("Missing acceptance");
				const session = accepted.event.routes?.find((r) => r.session)?.session;
				if (!session) throw new Error("Missing session");
				stop = await running.sessions.observe(session, async (update) => {
					updates.push(update);
				});
				await expect
					.poll(
						() =>
							scenario === "generation"
								? updates.some(
										(update) =>
											update.type === "message" &&
											update.streaming === true &&
											(update.message as { role?: string } | undefined)?.role === "assistant",
									)
								: updates.some((p) => p.type === "tool" && p.tool?.phase === "start"),
						{ timeout: 60000 },
					)
					.toBe(true);
				send(
					scenario === "interrupt" || scenario === "foreign-steer" ? interrupt : cli,
					scenario === "foreign-steer"
						? "Input B is from another source. When this input is run after the active source finishes, reply exactly QUEUE_B_ONLY. No tools."
						: "Input B replaces the requested final answer. Do not call any more tools. After reading all queued inputs including Input C, reply exactly QUEUE_MERGED_A_B_C. No other text.",
				);
				send(
					cli,
					scenario === "foreign-steer"
						? "Input C continues the original source. Reply exactly QUEUE_A_C after reading this input. No more tools."
						: "Input C. Final answer must be exactly QUEUE_MERGED_A_B_C. No more tools and no long explanation.",
				);
				await expect.poll(() => packets.filter((p) => p.type === "accepted").length, { timeout: 5000 }).toBe(3);
				const acceptedInputs = packets.filter((p): p is { type: "accepted"; event: YEvent } => p.type === "accepted");
				const inputA = acceptedInputs[0]?.event;
				if (!inputA) throw new Error("Missing first input acceptance");
				const inputB =
					acceptedInputs.find((item) => item.event.conv !== inputA.conv)?.event ??
					acceptedInputs.find((item) => item.event.id !== inputA.id)?.event;
				const inputC = acceptedInputs.find(
					(item) => item.event.id !== inputA.id && item.event.id !== inputB?.id,
				)?.event;
				if (!inputB || !inputC) throw new Error("Missing queued input acceptances");
				let merged: YEvent | undefined;
				await expect
					.poll(
						async () => {
							const ends = (await running.events.query({ type: "run.end" })).events;
							merged = ends.find((event) => {
								const inputs = (event.data as { inputs?: string[] }).inputs ?? [];
								return scenario === "foreign-steer"
									? inputs.length === 2 && inputs.includes(inputA.id) && inputs.includes(inputC.id)
									: inputs.length === 3 && !inputs.includes(onboardingId);
							});
							return merged !== undefined;
						},
						{ timeout: 90000 },
					)
					.toBe(true);
				if (!merged) throw new Error("Missing merged user run");
				const data = merged.data as { inputs: string[]; status: string };
				expect(data.inputs).toHaveLength(scenario === "foreign-steer" ? 2 : 3);
				if (scenario === "foreign-steer") {
					expect(data.inputs).toEqual(expect.arrayContaining([inputA.id, inputC.id]));
				} else {
					expect(data.inputs).toEqual(expect.arrayContaining([inputA.id, inputB.id, inputC.id]));
				}
				expect(data.status).toBe("done");
				if (scenario === "foreign-steer") {
					let foreign: YEvent | undefined;
					await expect
						.poll(
							async () => {
								foreign = (await running.events.query({ type: "run.end" })).events.find((event) => {
									const inputs = (event.data as { inputs?: string[] }).inputs ?? [];
									return inputs.length === 1 && inputs[0] === inputB.id;
								});
								return foreign !== undefined;
							},
							{ timeout: 90000 },
						)
						.toBe(true);
					if (!foreign) throw new Error("Missing foreign source run");
					expect((foreign.data as { status: string }).status).toBe("done");
					expect(merged.conv).toBe(inputA.conv);
					expect(foreign.conv).toBe(inputB.conv);
					for (const [conv, parent, marker] of [
						[inputA.conv, inputA.id, "QUEUE_A_C"],
						[inputB.conv, inputB.id, "QUEUE_B_ONLY"],
					] as const) {
						let delivered: YEvent | undefined;
						await expect
							.poll(
								async () => {
									delivered = (await running.events.query({ type: "message.out" })).events.find((event) => {
										const data = event.data as { text?: string; delivery?: { ok?: boolean } };
										return (
											event.conv === conv &&
											event.parent === parent &&
											data.delivery?.ok === true &&
											data.text?.includes(marker)
										);
									});
									return delivered !== undefined;
								},
								{ timeout: 5000 },
							)
							.toBe(true);
						expect(delivered).toMatchObject({ conv, parent });
					}
				} else {
					const expectedDeliveries = scenario === "interrupt" ? 2 : 1;
					await expect
						.poll(
							async () =>
								(await running.events.query({ type: "message.out" })).events.filter((event) => {
									const data = event.data as { text?: string; delivery?: { ok?: boolean } };
									return data.delivery?.ok === true && data.text?.includes("QUEUE_MERGED_A_B_C");
								}).length === expectedDeliveries,
							{ timeout: 5000 },
						)
						.toBe(true);
					const messages = (await running.events.query({ type: "message.out" })).events;
					const deliveries = messages.filter((event) => {
						const data = event.data as { text?: string; delivery?: { ok?: boolean } };
						return data.delivery?.ok === true && data.text?.includes("QUEUE_MERGED_A_B_C");
					});
					expect(deliveries).toHaveLength(expectedDeliveries);
					if (scenario === "interrupt") {
						expect(deliveries.map((event) => event.conv)).toEqual(expect.arrayContaining([inputA.conv, inputB.conv]));
						expect(deliveries).toEqual(
							expect.arrayContaining([
								expect.objectContaining({ conv: inputA.conv, parent: inputA.id }),
								expect.objectContaining({ conv: inputB.conv, parent: inputB.id }),
							]),
						);
					} else {
						expect(deliveries).toEqual([expect.objectContaining({ conv: inputA.conv, parent: inputA.id })]);
					}
				}
				const messages = (await running.events.query({ type: "message.out" })).events;
				expect(messages.some((e) => (e.data as { text: string }).text.startsWith("QUEUE_OLD"))).toBe(false);
				if (scenario !== "generation") {
					expect(updates.filter((p) => p.type === "tool" && p.tool?.phase === "start")).toHaveLength(1);
					const ended = updates.find((p) => p.type === "tool" && p.tool?.phase === "end")?.tool?.result as
						| { isError?: boolean }
						| undefined;
					expect(ended?.isError).toBe(scenario === "interrupt");
				}
			} finally {
				if (kernel) {
					const ends = (await kernel.events.query({ type: "run.end" })).events;
					const messages = (await kernel.events.query({ type: "message.out" })).events;
					await writeFile(
						`${home}/evidence.json`,
						JSON.stringify({ scenario, packets, updates, ends, messages }, null, 2),
					);
					console.log(`Queue evidence: ${home}/evidence.json`);
				}
				await stop?.();
				for (const socket of sockets) socket.destroy();
				await kernel?.close();
				if (process.env.YONDER_KEEP_TEST_HOME !== "1") await rm(home, { recursive: true, force: true });
			}
		},
		180000,
	);
}
