import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../../api";
import type { BotDevices } from "../../api/types";
import { setWorkDevices } from "../../work/lib/workOnline";

/** 账号全部已绑定设备（spec 19 §2）。与工作列表共用 ["account-devices"]，一处刷新两处更新。 */
export function useAccountDevices(accountId: string | undefined) {
	const query = useQuery({
		queryKey: ["account-devices", accountId],
		enabled: !!accountId,
		queryFn: api.devices,
		retry: false,
		refetchInterval: 5000,
	});
	// 设备页也要把这批事实交给工作桥的在线判断：设备详情里的会话列表走远程 rpc，缺了它就一律报「设备暂未连接」。
	useEffect(() => {
		if (query.data) setWorkDevices(query.data);
	}, [query.data]);
	return query;
}

/** 设备主人可见的 grant 摘要（19 §10）；observed:false 表示设备从未上报。 */
export function useDeviceGrants(deviceId: string | undefined) {
	return useQuery({
		queryKey: ["device-grants", deviceId],
		enabled: !!deviceId,
		queryFn: () => api.deviceGrants(deviceId!),
		retry: false,
		refetchInterval: 5000,
	});
}

/** Bot 的生效设备集合（19 §9）；账号级允许表，默认全部。 */
export function useBotDevices(botId: string | undefined) {
	return useQuery({
		queryKey: ["bot-devices", botId],
		enabled: !!botId,
		queryFn: () => api.botDevices(botId!),
		retry: false,
	});
}

/** 写允许表后同时刷新两个读接口：允许表本身和按设备列 Bot 的页面。 */
export function useSetBotDevices(botId: string | undefined) {
	const qc = useQueryClient();
	return async (input: Parameters<typeof api.setBotDevices>[1]): Promise<BotDevices> => {
		const next = await api.setBotDevices(botId!, input);
		qc.setQueryData(["bot-devices", botId], next);
		void qc.invalidateQueries({ queryKey: ["device-grants"] });
		return next;
	};
}

export function useRevokeGrant(deviceId: string | undefined) {
	const qc = useQueryClient();
	return async (grantId: string): Promise<{ revoked: true; pending: boolean }> => {
		const result = await api.revokeDeviceGrant(deviceId!, grantId);
		void qc.invalidateQueries({ queryKey: ["device-grants", deviceId] });
		void qc.invalidateQueries({ queryKey: ["bot-devices"] });
		return result;
	};
}
