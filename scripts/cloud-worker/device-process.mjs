import { redactError } from "../../packages/bot-core/dist/delivery/model-notice.js";
import { workControl } from "../../packages/gateway/dist/index.js";
import { openKernel } from "../../packages/local-host/dist/kernel/index.js";
import { releaseInfo } from "../../packages/local-host/dist/release/index.js";

let kernel;
let closing;
const catalogues = [];
const calls = [];
let expectedSourceId;

function send(message) {
	if (process.connected) process.send(message);
}

async function close() {
	if (closing) return closing;
	closing = (async () => {
		await kernel?.close();
		send({ type: "closed" });
		if (process.connected) process.disconnect();
	})();
	return closing;
}

try {
	const home = process.env.CLOUD_DEVICE_HOME;
	kernel = await openKernel(home, { log: () => {} });
	const host = {
		kernel,
		home,
		releaseInfo: () => releaseInfo(home),
		awakeStatus: () => {
			throw new Error("Headless device harness does not provide awake status");
		},
		stop: () => void close(),
	};
	kernel.setWorkHost((instance) => workControl(host, instance));
	const catalog = kernel.programTools.catalog.bind(kernel.programTools);
	const call = kernel.programTools.call.bind(kernel.programTools);
	kernel.programTools.catalog = async (...args) => {
		const result = await catalog(...args);
		const names = result.tools.map((tool) => tool.name);
		catalogues.push(names);
		send({ type: "catalog", tools: names });
		return result;
	};
	kernel.programTools.call = async (...args) => {
		const result = await call(...args);
		const tool = args[0].tool;
		const sourceMessageIds = args[0]?.source?.sourceMessageIds;
		const sourceMatchesExpected =
			typeof expectedSourceId === "string" &&
			Array.isArray(sourceMessageIds) &&
			sourceMessageIds.includes(expectedSourceId);
		calls.push({ tool, ok: result.isError !== true, sourceMatchesExpected });
		send({ type: "tool-call", tool, ok: result.isError !== true, sourceMatchesExpected });
		return result;
	};
	send({ type: "ready" });
	process.on("message", (message) => {
		if (message?.type === "expect-source" && typeof message.messageId === "string") {
			expectedSourceId = message.messageId;
			send({ type: "source-armed" });
		}
		if (message?.type === "login" && typeof message.code === "string") {
			void kernel.channels
				.login({ instance: "card", action: "poll", verifyCode: message.code }, new AbortController().signal)
				.then((result) => send({ type: "login", status: result.status }))
				.catch((error) =>
					send({
						type: "login",
						status: "failed",
						reason: redactError(error instanceof Error ? error.message : "Login failed").slice(0, 300),
					}),
				);
		} else if (message?.type === "snapshot") {
			send({ type: "snapshot", catalogues: catalogues.length, calls: [...calls] });
		} else if (message === "close") {
			void close().catch(() => process.exit(1));
		}
	});
	process.once("disconnect", () => void close().catch(() => process.exit(1)));
} catch (error) {
	send({
		type: "fatal",
		reason: redactError(error instanceof Error ? error.message : "Device process failed").slice(0, 300),
	});
	process.exitCode = 1;
}
