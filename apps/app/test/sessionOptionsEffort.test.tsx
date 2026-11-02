import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { SessionOptions } from "../src/work/ui/SessionOptions";

test("the shared model button hides effort for a non-reasoning model", () => {
	const client = new QueryClient();
	client.setQueryData(["models", "local"], {
		providers: [
			{
				id: "cloud-99716501-1a2f-43f5-8337-994ff03cc71a",
				name: "WorkBuddy 反向映射（依赖本机在线，验收） · workbuddy",
				models: [
					{
						provider: "cloud-99716501-1a2f-43f5-8337-994ff03cc71a",
						id: "deepseek-v4.1-flash",
						name: "DeepSeek V4.1 Flash (WorkBuddy free)",
						source: "cloud",
						reasoning: false,
						effortLevels: ["off"],
					},
				],
			},
		],
		permissions: [],
	});
	const html = renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<SessionOptions
					node={{ id: "local" }}
					value={{ model: "cloud-99716501-1a2f-43f5-8337-994ff03cc71a/deepseek-v4.1-flash", effort: "medium" }}
					onChange={() => {}}
					runtime={null}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	expect(html).toContain("DeepSeek V4.1 Flash");
	expect(html).toContain("WorkBuddy 反向映射");
	expect(html).not.toContain("cloud-99716501");
	expect(html).not.toContain(">medium</span>");
});
