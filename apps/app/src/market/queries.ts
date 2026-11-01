import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ListingQuery } from "../api/client";
import type { MarketFilters } from "./flows";

export function listingFilters(q: string, filters: MarketFilters): ListingQuery {
	return {
		q: q || undefined,
		kind: filters.kind === "全部" || filters.kind === "other" ? undefined : (filters.kind as ListingQuery["kind"]),
		category: filters.category === "全部" ? undefined : (filters.category as ListingQuery["category"]),
		city: filters.city === "不限" ? undefined : filters.city,
		min: filters.min || undefined,
		max: filters.max || undefined,
		sort:
			filters.sort === "最新"
				? "newest"
				: filters.sort === "价格从低到高"
					? "price_asc"
					: filters.sort === "价格从高到低"
						? "price_desc"
						: "relevance",
	};
}

export function useListingFeed(filters: ListingQuery = {}, enabled = true) {
	const query = useInfiniteQuery({
		queryKey: ["market-listings", "feed", filters],
		queryFn: ({ pageParam }) => api.marketListings({ ...filters, cursor: pageParam }),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.nextCursor,
		enabled,
	});
	return { ...query, items: query.data?.pages.flatMap((page) => page.items) ?? [] };
}

/** Absence from a feed page is not evidence that a saved or linked listing was removed. */
export function useListingLookup(ids: string[]) {
	const unique = [...new Set(ids)];
	const queries = useQueries({
		queries: unique.map((id) => ({
			queryKey: ["market-listings", "item", id],
			queryFn: () => api.marketListing(id),
			staleTime: 60_000,
		})),
	});
	return {
		items: queries.flatMap((query) => (query.data ? [query.data] : [])),
		missing: unique.filter((_, index) => queries[index].isSuccess && queries[index].data === null),
		isPending: queries.some((query) => query.isPending),
		isError: queries.some((query) => query.isError),
		refetch: () => Promise.all(queries.map((query) => query.refetch())),
	};
}

export function useMarketCapabilities() {
	return useQuery({
		queryKey: ["market-capabilities"],
		queryFn: api.marketCapabilities,
		retry: false,
		refetchOnWindowFocus: true,
	});
}
