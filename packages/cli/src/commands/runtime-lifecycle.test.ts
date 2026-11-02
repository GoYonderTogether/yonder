import { afterEach, expect, test, vi } from "vitest";

// These are lifecycle handles only: no model, session, or response is simulated.
const lifecycle = vi.hoisted(() => ({
	kernelClose: vi.fn(async () => {}),
	gatewayClose: vi.fn(async () => {}),
	controlClose: vi.fn(async () => {}),
	statusStop: vi.fn(async () => {}),
	awakeClose: vi.fn(),
	startGateway: vi.fn(),
	serveControl: vi.fn(),
}));
vi.mock("@yonder/local-host", () => ({
	offlineQuery: async () => [{ id: "interaction" }],
	openKernel: async () => ({ close: lifecycle.kernelClose, setWorkHost: () => {} }),
	gatewaySettings: async () => ({ enabled: true }),
	controlHandler: (host: unknown) => host,
	serveControl: lifecycle.serveControl,
}));
vi.mock("@yonder/gateway", () => ({ startGateway: lifecycle.startGateway }));
vi.mock("../awake.js", () => ({ startAwake: () => ({ close: lifecycle.awakeClose }) }));
vi.mock("../status-surface.js", () => ({ startStatusSurface: () => ({ stop: lifecycle.statusStop }) }));
vi.mock("./context.js", () => ({ homeFor: () => "lifecycle-home", output: () => {} }));

import { runRuntime } from "./runtime.js";

const options = { json: true, help: false, rest: [] };
afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test.each([false, true])("early repeated stop waits for gateway startup (failure: %s)", async (fail) => {
	vi.stubEnv("YONDER_HOME", process.env.YONDER_HOME);
	const entered = deferred<{ stop: () => void }>();
	const gateway = deferred<{ port: number; close: () => Promise<void> }>();
	lifecycle.startGateway.mockImplementation(({ host }) => {
		entered.resolve(host);
		return gateway.promise;
	});
	lifecycle.serveControl.mockResolvedValue({ close: lifecycle.controlClose });
	const running = runRuntime("start", options, []);
	const result = running.then(
		() => undefined,
		(error: Error) => error,
	);
	const host = await entered.promise;
	expect(lifecycle.serveControl).not.toHaveBeenCalled();
	host.stop();
	host.stop();
	await Promise.resolve();
	expect(lifecycle.kernelClose).not.toHaveBeenCalled();
	expect(lifecycle.statusStop).not.toHaveBeenCalled();
	const failure = new Error("gateway startup failed");
	if (fail) gateway.reject(failure);
	else gateway.resolve({ port: 7690, close: lifecycle.gatewayClose });
	expect(await result).toBe(fail ? failure : undefined);
	expect(lifecycle.kernelClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.statusStop).toHaveBeenCalledTimes(1);
	expect(lifecycle.awakeClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.gatewayClose).toHaveBeenCalledTimes(fail ? 0 : 1);
	expect(lifecycle.controlClose).toHaveBeenCalledTimes(fail ? 0 : 1);
	expect(lifecycle.serveControl).toHaveBeenCalledTimes(fail ? 0 : 1);
});

test("control is published after gateway startup and its stop closes both listeners", async () => {
	vi.stubEnv("YONDER_HOME", process.env.YONDER_HOME);
	const published = deferred<{ stop: () => void }>();
	lifecycle.startGateway.mockResolvedValue({ port: 7690, close: lifecycle.gatewayClose });
	lifecycle.serveControl.mockImplementation(async (_home, host) => {
		published.resolve(host);
		return { close: lifecycle.controlClose };
	});
	const running = runRuntime("start", options, []);
	const host = await published.promise;
	host.stop();
	await expect(running).resolves.toBe(0);
	expect(lifecycle.gatewayClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.controlClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.kernelClose).toHaveBeenCalledTimes(1);
});

test("control startup failure closes the already-started gateway and kernel", async () => {
	vi.stubEnv("YONDER_HOME", process.env.YONDER_HOME);
	const failure = new Error("control listener failed");
	lifecycle.startGateway.mockResolvedValue({ port: 7690, close: lifecycle.gatewayClose });
	lifecycle.serveControl.mockRejectedValue(failure);
	await expect(runRuntime("start", options, [])).rejects.toBe(failure);
	expect(lifecycle.gatewayClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.kernelClose).toHaveBeenCalledTimes(1);
	expect(lifecycle.statusStop).toHaveBeenCalledTimes(1);
	expect(lifecycle.awakeClose).toHaveBeenCalledTimes(1);
});

test("late control failure shuts down owned resources and reports failure", async () => {
	vi.stubEnv("YONDER_HOME", process.env.YONDER_HOME);
	const published = deferred<(error: Error) => void>();
	lifecycle.startGateway.mockResolvedValue({ port: 7690, close: lifecycle.gatewayClose });
	lifecycle.serveControl.mockImplementation(async (_home, _host, onError) => {
		published.resolve(onError);
		return { close: lifecycle.controlClose };
	});
	const running = runRuntime("start", options, []);
	const failure = new Error("native accept failed");
	(await published.promise)(failure);
	await expect(running).rejects.toBe(failure);
	for (const close of [
		lifecycle.awakeClose,
		lifecycle.statusStop,
		lifecycle.gatewayClose,
		lifecycle.controlClose,
		lifecycle.kernelClose,
	])
		expect(close).toHaveBeenCalledTimes(1);
	expect(lifecycle.gatewayClose.mock.invocationCallOrder[0]).toBeLessThan(
		lifecycle.controlClose.mock.invocationCallOrder[0] ?? 0,
	);
	expect(lifecycle.controlClose.mock.invocationCallOrder[0]).toBeLessThan(
		lifecycle.kernelClose.mock.invocationCallOrder[0] ?? 0,
	);
});
