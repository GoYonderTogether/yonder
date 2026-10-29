import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "../../src/work/api/social";
import { Connect } from "../../src/work/features/social/Connect";

vi.mock("../../src/work/api/social", () => ({ httpApi: { deviceCode: vi.fn(), devices: vi.fn(), createInvite: vi.fn() } }));

beforeEach(() => {
	vi.stubGlobal("location", { search: "?code=123", hash: "#/connect", origin: "https://example.test" });
	vi.clearAllMocks();
});

function render(client: QueryClient) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<Connect />
		</QueryClientProvider>,
	);
}
function client() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("Connect", () => {
	it("renders loading", () => {
		expect(render(client())).toContain("正在加载");
	});
	it("renders an empty device list", () => {
		vi.stubGlobal("location", { search: "", hash: "#/connect", origin: "https://example.test" });
		const qc = client();
		qc.setQueryData(["devices"], []);
		expect(render(qc)).toContain("正在生成邀请码");
	});
	it("renders the device", () => {
		const qc = client();
		qc.setQueryData(["device-code", "123"], { name: "My computer", status: "pending" });
		expect(render(qc)).toContain("My computer");
	});
	it("renders an error", async () => {
		const qc = client();
		vi.mocked(httpApi.deviceCode).mockRejectedValueOnce(new Error("invalid"));
		await qc
			.fetchQuery({ queryKey: ["device-code", "123"], queryFn: () => httpApi.deviceCode("123"), retry: false })
			.catch(() => {});
		expect(render(qc)).toContain("授权码无效或已过期");
	});
});
