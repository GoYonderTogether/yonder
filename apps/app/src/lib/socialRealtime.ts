import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api";
import type { Message } from "../api/types";

/** Socket delivery is a hint; HTTP reconciles missed messages and unread counts. */
export function useSocialRealtime() {
	const qc = useQueryClient();
	useEffect(
		() =>
			api.subscribe(
				(message) => {
					const key = ["msgs", message.convId];
					const old = qc.getQueryData<Message[]>(key);
					const last = old?.at(-1);
					if (last && message.seq > last.seq + 1) {
						void qc.invalidateQueries({ queryKey: key });
					} else if (old && !old.some((item) => item.id === message.id) && (!last || message.seq > last.seq)) {
						qc.setQueryData(key, [...old, message].slice(-120));
					}
					void qc.invalidateQueries({ queryKey: ["convs"] });
				},
				() => {
					void qc.invalidateQueries({ queryKey: ["convs"] });
					void qc.invalidateQueries({ queryKey: ["msgs"] });
					void qc.invalidateQueries({ queryKey: ["actors"] });
				},
			),
		[qc],
	);
}
