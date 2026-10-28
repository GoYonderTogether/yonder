import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentPublicToggle } from "../../src/features/social/AgentPublicToggle";

const api = vi.hoisted(() => ({ setAgentPublic: vi.fn() }));
vi.mock("../../src/api/social", () => ({ httpApi: api }));

it("updates the public setting and invalidates the owner's contact", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	const root = createRoot(container);
	const client = new QueryClient();
	client.setQueryData(["contact", "agent"], { id: "agent" });
	api.setAgentPublic.mockResolvedValue({});
	try {
		await act(() =>
			root.render(
				<QueryClientProvider client={client}>
					<AgentPublicToggle actor={{ id: "agent", name: "Agent", kind: "agent", public: false }} />
				</QueryClientProvider>,
			),
		);
		const input = container.querySelector("input") as HTMLInputElement;
		await act(async () => {
			input.checked = true;
			input.click();
		});
		expect(api.setAgentPublic).toHaveBeenCalledWith("agent", true);
		expect(client.getQueryState(["contact", "agent"])?.isInvalidated).toBe(true);
	} finally {
		await act(() => root.unmount());
		vi.unstubAllGlobals();
	}
});
