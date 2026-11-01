import { writeSync } from "node:fs";

const [executorUrl, home, packet, descriptor, checkpoint] = process.argv.slice(2);
if (checkpoint !== "before" && checkpoint !== "after") throw new Error("Invalid crash checkpoint");
const { DeviceExecutor } = await import(executorUrl);
const executor = new DeviceExecutor(home, { describe: async () => JSON.parse(descriptor), actions: {} });
const save = executor.store.save.bind(executor.store);
executor.store.save = () => {
	if (checkpoint === "after") save();
	// Synchronous pipe write proves which real publication boundary was reached before SIGKILL.
	writeSync(1, `crash:${checkpoint}\n`);
	process.kill(process.pid, "SIGKILL");
};
await executor.handle(JSON.parse(packet));
throw new Error("Request completed without reaching the crash checkpoint");
