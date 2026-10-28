import { QueryClient } from "@tanstack/react-query";
import { RpcError } from "../client";

export { qk } from "../keys";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (count, error) => !(error instanceof RpcError && error.code === "unauthorized") && count < 2,
			refetchOnWindowFocus: true,
		},
	},
});
