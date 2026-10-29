import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { ChannelsSection } from "../src/work/features/settings/ChannelsSection";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", () => ({ rpc }));

test("lists channel instances and shows the login link returned by channels.login", async () => {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	rpc.mockImplementation(async (method: string, params: { instance?: string }) => {
		if (method === "channels.list")
			return [
				{ instance: "console", type: "console", login: false },
				{ instance: "wx", type: "weixin", login: true },
			];
		if (method === "channels.login" && params.instance === "wx")
			return { status: "pending", instance: "wx", qrcodeUrl: "https://example.com/qr" };
		throw new Error(`Unexpected ${method}`);
	});
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<ChannelsSection />
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => expect(container.textContent).toContain("console"));
		expect(container.querySelectorAll("button")).toHaveLength(1);
		const button = container.querySelector("button") as HTMLElement;
		await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
		await vi.waitFor(() => expect(container.querySelector('a[href="https://example.com/qr"]')).not.toBeNull());
		expect(rpc).toHaveBeenCalledWith("channels.login", { instance: "wx", action: "start" });
	} finally {
		await act(async () => root.unmount());
		client.clear();
		vi.unstubAllGlobals();
		rpc.mockReset();
	}
});
