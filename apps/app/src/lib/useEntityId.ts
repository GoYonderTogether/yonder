import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { isShortCode } from "./entityRef";

/** Only route aliases are resolved. Cache keys and mutations continue using UUIDs. */
export function useEntityId(kind: "actor" | "card" | "conversation" | "device", ref?: string) {
	const short = !!ref && isShortCode(ref);
	const query = useQuery({
		queryKey: ["resolve", kind, ref?.toUpperCase()],
		queryFn: () => api.resolve(kind, ref!.toUpperCase()),
		enabled: short,
	});
	return {
		id: short ? query.data?.id : ref,
		pending: short && query.isPending,
		error: short && query.isError,
		retry: query.refetch,
	};
}
