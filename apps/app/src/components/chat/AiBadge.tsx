import { useStore } from "@nanostores/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Actor } from "../../api/types";
import { $session } from "../../store";

/** 只在他人的 bot 上附上主人名称；完整名称保留在 tooltip。 */
export function AiBadge({ actor }: { actor?: Actor }) {
	const me = useStore($session)?.actor.id;
	const ownerId = actor?.ownerId;
	const foreign = !!ownerId && ownerId !== me;
	const { data } = useQuery({
		queryKey: ["actors", ownerId],
		queryFn: () => api.actors(ownerId ? [ownerId] : []),
		enabled: foreign,
	});
	const ownerName = foreign ? data?.[0]?.name : undefined;
	const label = ownerName ? `${ownerName}的 bot` : "bot";
	return (
		<span
			title={label}
			className="inline-flex max-w-28 shrink-0 rounded-chip bg-tone-2 px-1 text-caption leading-[18px] font-medium text-muted"
		>
			{ownerName ? (
				<>
					<span className="min-w-0 truncate">{ownerName}</span>
					<span className="shrink-0">的 bot</span>
				</>
			) : (
				"bot"
			)}
		</span>
	);
}
