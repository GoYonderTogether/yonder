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
				models: [
					{
						provider: "workbuddy",
						id: "deepseek-v4.1-flash",
						name: "DeepSeek V4.1 Flash (WorkBuddy free)",
						source: "runtime",
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
					value={{ model: "workbuddy/deepseek-v4.1-flash", effort: "medium" }}
					onChange={() => {}}
					runtime={null}
				/>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	expect(html).toContain("DeepSeek V4.1 Flash");
	expect(html).not.toContain(">medium</span>");
});
