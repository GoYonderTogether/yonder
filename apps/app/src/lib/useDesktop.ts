import { useSyncExternalStore } from "react";

const query = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
	const m = matchMedia(query);
	m.addEventListener("change", cb);
	return () => m.removeEventListener("change", cb);
};

/** 桌面布局：宽度 ≥ 1024。其余走手机布局。 */
export const useDesktop = () =>
	useSyncExternalStore(
		subscribe,
		() => matchMedia(query).matches,
		() => false,
	);
