import { useEffect, useState } from "react";

export function breakpointOf(width: number): "phone" | "tablet" | "desktop" {
	return width < 640 ? "phone" : width <= 1024 ? "tablet" : "desktop";
}
export function useBreakpoint() {
	const [breakpoint, setBreakpoint] = useState(() => breakpointOf(window.innerWidth));
	useEffect(() => {
		const update = () => setBreakpoint(breakpointOf(window.innerWidth));
		window.addEventListener("resize", update);
		return () => window.removeEventListener("resize", update);
	}, []);
	return breakpoint;
}
