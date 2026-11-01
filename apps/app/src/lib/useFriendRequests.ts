import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { friendsApi } from "../api/friends";
import { $session } from "../store";
export function useFriendRequests() {
	const me = useStore($session)?.actor;
	return useQuery({
		queryKey: ["friend-requests", me?.id],
		queryFn: friendsApi.requests,
		enabled: !!me && !me.anonymous,
		refetchInterval: 15000,
		retry: false,
	});
}
