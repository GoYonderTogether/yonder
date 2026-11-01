import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Listing } from "./types";

const MAX_TIMEOUT = 2_147_483_647;

/** Refresh only when the next loaded, visible owner listing reaches its real deadline. */
export function useListingExpiry(listings: Listing[], enabled: boolean) {
	const queryClient = useQueryClient();
	const now = Date.now();
	const next = listings.reduce(
		(deadline, listing) =>
			!listing.paused && typeof listing.expiresAt === "number" && listing.expiresAt > now
				? Math.min(deadline, listing.expiresAt)
				: deadline,
		Infinity,
	);
	useEffect(() => {
		if (!enabled || !Number.isFinite(next)) return;
		let timer: ReturnType<typeof setTimeout>;
		const arm = () => {
			const remaining = next - Date.now();
			if (remaining <= 0) {
				void queryClient.invalidateQueries({ queryKey: ["market-listings"] });
				return;
			}
			timer = setTimeout(arm, Math.min(remaining, MAX_TIMEOUT));
		};
		arm();
		return () => clearTimeout(timer);
	}, [enabled, next, queryClient]);
}
