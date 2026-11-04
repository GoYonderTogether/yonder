import { useEffect } from "react";
import { mux } from "../../api/stream";
import { effectiveLevel, usePrefs } from "../../lib/prefs";
// __TAURI_INTERNALS__ 的全局声明唯一来源是 lib/nativePermissions.ts，这里不再重复声明。

export function NotifyHost() {
	const prefs = usePrefs();
	useEffect(() => {
		if (!window.__YONDER_SHELL__ || !window.__TAURI_INTERNALS__) return;
		return mux.subscribe(
			"activity.watch",
			{},
			{
				onReady: () => undefined,
				onEvent: (type, data) => {
					if (type !== "notification" || !data || typeof data !== "object") return;
					const event = data as { text?: unknown; from?: unknown; session?: unknown; conv?: unknown };
					const key =
						typeof event.conv === "string" ? event.conv : typeof event.session === "string" ? event.session : "";
					if (effectiveLevel(prefs.level[key], prefs.notify) !== "all") return;
					void window.__TAURI_INTERNALS__?.invoke("plugin:notification|notify", {
						options: {
							extra: typeof event.session === "string" ? { session: event.session } : {},
							title: typeof event.from === "string" ? event.from : "Yonder",
							body: prefs.notify.previews && typeof event.text === "string" ? event.text : "收到新通知",
						},
					});
				},
			},
		);
	}, [prefs]);
	return null;
}
