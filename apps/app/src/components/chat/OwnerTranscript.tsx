import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import type { Actor } from "../../api/types";
import { type NodeTarget, rpc } from "../../work/api/client";
import type { SessionInfo } from "../../work/api/types";
import { fetchDeviceAgents } from "../../work/lib/queries";
import { useSession } from "../../work/lib/useSession";
import { Transcript } from "../../work/ui/Transcript";

export interface OwnerBinding {
	sessionId: string;
	target: NodeTarget;
}

/** Only an owned, device-registered Bot can open the owner's full transcript. */
export async function ownerConversation(bot: Actor, ownerId: string): Promise<OwnerBinding | null> {
	if (bot.kind !== "agent" || bot.ownerId !== ownerId || !bot.deviceId) return null;
	const target: NodeTarget = { deviceId: bot.deviceId };
	const agents = await fetchDeviceAgents(bot.deviceId);
	const key = agents.find(
		({ actor }) => actor.id === bot.id && actor.ownerId === ownerId && actor.deviceId === bot.deviceId,
	)?.key;
	if (!key) return null;
	const sessions = await rpc<SessionInfo[]>("sessions.list", {}, undefined, target);
	const session = sessions.find((item) => item.mode === "main" && item.agent === key && !item.closed);
	return session ? { sessionId: session.id, target } : null;
}

export function useOwnerConversation(bot: Actor | undefined, ownerId: string | undefined) {
	return useQuery({
		queryKey: ["owner-conversation", ownerId, bot?.id, bot?.deviceId],
		enabled: !!bot && !!ownerId && bot.kind === "agent" && bot.ownerId === ownerId && !!bot.deviceId,
		queryFn: () => (bot && ownerId ? ownerConversation(bot, ownerId) : null),
		retry: false,
		staleTime: 30_000,
	});
}

export function OwnerTranscript({
	binding,
	onQuote,
	backgroundStyle,
}: {
	binding: OwnerBinding;
	onQuote(text: string): void;
	backgroundStyle?: CSSProperties;
}) {
	const view = useSession(binding.sessionId, binding.target);
	return (
		<div
			className="social-owner-transcript flex min-h-0 flex-1 flex-col"
			style={backgroundStyle}
			data-chat-background={backgroundStyle?.backgroundImage ? "image" : undefined}
		>
			{!view.ready ? (
				<p role="status" className="flex-1 p-4 text-small text-muted">
					{view.error ?? "正在加载完整会话…"}
				</p>
			) : (
				<Transcript
					items={view.items}
					hasMore={view.hasMore}
					onOlder={view.loadOlder}
					hasNewer={view.hasNewer}
					onNewer={view.loadNewer}
					loadingOlder={view.loadingOlder}
					olderError={view.olderError}
					onQuote={(item) => onQuote(item.text)}
				/>
			)}
		</div>
	);
}
