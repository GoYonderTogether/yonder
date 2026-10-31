import { useLocation, useNavigate } from "react-router";

/** Only application-created history state is consumed; URL query never controls return. */
export function internalState(location: { pathname: string; search: string }) {
	return { appFrom: location.pathname + location.search };
}

export function hasInternalOrigin(state: unknown): state is { appFrom: string } {
	if (!state || typeof state !== "object" || !("appFrom" in state)) return false;
	return (
		typeof state.appFrom === "string" &&
		state.appFrom.startsWith("/") &&
		!state.appFrom.startsWith("//") &&
		!/[\\\r\n]/.test(state.appFrom)
	);
}

export function useAppBack(fallback: string) {
	const nav = useNavigate();
	const loc = useLocation();
	return () => (hasInternalOrigin(loc.state) ? nav(-1) : nav(fallback, { replace: true }));
}

/** Personal market pages return to their actual Me history entry, or replace a deep link. */
export function usePersonalMarketBack() {
	const nav = useNavigate();
	const loc = useLocation();
	return () =>
		hasInternalOrigin(loc.state) && /^\/me(?:\?|$)/.test(loc.state.appFrom) ? nav(-1) : nav("/me", { replace: true });
}
