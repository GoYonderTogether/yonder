import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { ShareLinkKind } from "../api/types";
import { $session } from "../store";
import { rememberShareToken, shareLinkKey, shareLinkUrl } from "./shareLinks";

export interface ShareTarget {
	kind: ShareLinkKind;
	targetId: string;
	/** 落地页路径（/u/…、/p/…、/g/…） */
	path: string;
}

/**
 * 分享二维码用的地址：自己的名片/群先向服务端要分享链接（`?share=<token>`），访客凭它登录时服务端才计配额。
 * 服务端对同一目标复用未过期链接，所以每次打开不会新增配额。
 * 没有目标、访客身份或生成失败时退回普通地址。
 */
export function useShareUrl(target: ShareTarget | undefined, plain: string, enabled: boolean): string {
	const session = useStore($session);
	const usable = enabled && !!target && !!session && !session.actor.anonymous;
	const { data } = useQuery({
		queryKey: ["share-link", target?.kind, target?.targetId],
		enabled: usable,
		retry: false,
		staleTime: 5 * 60_000,
		queryFn: async () => {
			const link = await api.createShareLink({ kind: target?.kind ?? "card", targetId: target?.targetId ?? "" });
			rememberShareToken(shareLinkKey(link.kind, link.targetId), link.token);
			return shareLinkUrl(link, target?.path ?? "", location.origin);
		},
	});
	return usable && data ? data : plain;
}
