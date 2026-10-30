import { requestControl } from "@yonder/core";

export interface ChannelsLoginParams {
	instance?: string;
	action: "start" | "poll";
	verifyCode?: string;
	replace?: boolean;
}

/**
 * 渠道登录只能由运行中的服务完成。服务没起来时 `control.sock` 的 ENOENT 要翻成可操作的提示，
 * 而不是把裸系统错误丢给人（JV2-J02-01）。
 */
export async function loginChannel(home: string, params: ChannelsLoginParams) {
	try {
		return (await requestControl(home, { method: "channels.login", params })) as { qrcodeUrl?: string };
	} catch (error) {
		if (!connectionUnavailable(error)) throw error;
		throw new Error(
			"服务未启动，先运行 yonder start · Service is not running: run `yonder start` first, then connect again",
		);
	}
}

function connectionUnavailable(error: unknown) {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ECONNREFUSED" || code === "ENOENT";
}
