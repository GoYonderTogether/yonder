import { useStore } from "@nanostores/react";
import { atom } from "nanostores";
import { useEffect } from "react";
import { $session } from "../store";
import { toast } from "../ui/Toast";
import { upgradeMarketState } from "./catalog";
import { initialMarketState } from "./data";
import { normalizeInquiries } from "./flows";
import type { MarketState } from "./types";

const stores = new Map<string, ReturnType<typeof atom<MarketState>>>();
function read(key: string) {
	const initial = initialMarketState();
	try {
		const raw = JSON.parse(localStorage.getItem(key) ?? "null");
		if (raw) {
			const state = upgradeMarketState(raw, initial);
			return { ...state, inquiries: normalizeInquiries(state.inquiries) };
		}
	} catch {
		/* A missing or damaged preview cache starts with the sample catalog. */
	}
	return initial;
}
export function useMarketState() {
	const account = useStore($session)?.actor.id ?? "guest";
	const storageKey = `yonder-market-demo:v1:${account}`;
	if (!stores.has(storageKey)) stores.set(storageKey, atom(read(storageKey)));
	const store = stores.get(storageKey)!;
	const state = useStore(store);
	useEffect(() => {
		const sync = (event: StorageEvent) => {
			if (event.key === storageKey) store.set(read(storageKey));
		};
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, [storageKey, store]);
	const setState = (update: (previous: MarketState) => MarketState) => {
		const next = update(store.get());
		store.set(next);
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			toast("存储空间不足，当前改动仅在本次打开时保留。请减少上传图片。", true);
		}
	};
	return { state, setState, storageKey };
}
