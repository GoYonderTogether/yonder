import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api";
import { clearPersistedCache, selectAccount } from "../cache";
import { $session } from "../store";
import { toast } from "../ui/Toast";

export function useLogout() {
	const nav = useNavigate();
	const qc = useQueryClient();
	return async () => {
		try {
			await api.logout();
			clearPersistedCache(qc);
			selectAccount(null, qc);
			$session.set(null);
			nav("/login");
		} catch (error) {
			toast(error instanceof Error ? error.message : "退出失败，请重试", true);
		}
	};
}
