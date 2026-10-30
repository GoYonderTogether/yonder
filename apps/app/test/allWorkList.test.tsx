import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("../src/work/api/work", () => ({
	workSessions: async (node: { deviceId: string }) => [
		{
			id: "42",
			agent: null,
			profile: node.deviceId,
			title: node.deviceId,
			mode: "task",
			key: "",
			version: "1",
			opened: "2026-10-30",
		},
	],
}));
vi.mock("../src/work/api/client", () => ({ rpc: async () => ({ sessions: [] }) }));
vi.mock("../src/work/lib/queries", () => ({ fetchDeviceAgents: async () => [], deviceAgentMap: () => new Map() }));

it("opens the same session id on the device whose row was selected", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	const selected = vi.fn();
	const { AllWorkList } = await import("../src/work/ui/AllWorkList");
	const devices = ["a", "b"].map((id) => ({
		id,
		name: id,
		kind: "desktop" as const,
		online: true,
		workProtocol: 1 as const,
	}));
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<AllWorkList accountId="owner" devices={devices} onOpen={selected} />
				</MemoryRouter>
			</QueryClientProvider>,
		);
	});
	for (let i = 0; i < 20 && !container.querySelector('section[aria-label="b"] button'); i++)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
	const section = container.querySelector('section[aria-label="b"]');
	const button = [...section!.querySelectorAll("button")].find((item) => item.textContent === "b");
	await act(() => button!.dispatchEvent(new window.Event("click", { bubbles: true })));
	expect(selected).toHaveBeenCalledWith(devices[1], "42");
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});
