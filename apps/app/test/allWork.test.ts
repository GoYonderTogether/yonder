import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("../src/work/api/client", () => ({ rpc, RpcError: class extends Error {} }));

beforeEach(() => {
	rpc.mockReset();
});

it("queries each device explicitly even when their session ids are identical", async () => {
	rpc.mockImplementation(async (_method, params, _signal, node) =>
		params.filter
			? []
			: [{ id: "42", agent: null, profile: node.deviceId, mode: "task", key: "", version: "1", opened: "" }],
	);
	const { workSessions } = await import("../src/work/api/work");
	const [a, b] = await Promise.all([workSessions({ deviceId: "a" }), workSessions({ deviceId: "b" })]);
	expect(a[0]?.profile).toBe("a");
	expect(b[0]?.profile).toBe("b");
	expect(rpc.mock.calls.map((call) => call[3].deviceId)).toEqual(["a", "a", "b", "b"]);
});
