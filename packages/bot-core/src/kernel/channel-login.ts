import type { Channel } from "@yonder/sdk";

/** Channel-instance login: validate the request shape, then hand it to the channel's own login. */
export function createChannelLogin(loaded: { channels: Map<string, Channel> }) {
	return async (
		request: { instance?: string; action?: "start" | "poll"; verifyCode?: string; replace?: boolean },
		signal: AbortSignal,
	) => {
		if (
			request.instance !== undefined &&
			(typeof request.instance !== "string" || !/^[a-z0-9-]+$/.test(request.instance))
		)
			throw new Error("Invalid channel instance");
		if (request.action !== undefined && !["start", "poll"].includes(request.action))
			throw new Error("Invalid channel login action");
		if (request.replace !== undefined && typeof request.replace !== "boolean")
			throw new Error("Invalid channel replacement option");
		if (
			request.verifyCode !== undefined &&
			(typeof request.verifyCode !== "string" || !/^\d{1,12}$/.test(request.verifyCode))
		)
			throw new Error("Invalid channel verification code");
		const channel = request.instance
			? loaded.channels.get(request.instance)
			: [...loaded.channels.values()].find((channel) => channel.login);
		if (!channel?.login) throw new Error("No configured login-capable channel; configure a channel instance first");
		return channel.login(
			request.action ?? (request.verifyCode ? "poll" : "start"),
			signal,
			request.verifyCode,
			request.replace,
		);
	};
}
