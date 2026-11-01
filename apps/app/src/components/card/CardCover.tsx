import { useState } from "react";
import { isAvatarUrl } from "../../api/avatarUrl";

/** A failed cover leaves the neutral parent surface visible. Blob previews are editor-only. */
export function CardCover({
	url,
	local = false,
	className = "h-full w-full object-cover",
}: {
	url?: string | null;
	local?: boolean;
	className?: string;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	if (!url || failed === url || (!(local && url.startsWith("blob:")) && !isAvatarUrl(url))) return null;
	return <img src={url} alt="" referrerPolicy="no-referrer" className={className} onError={() => setFailed(url)} />;
}
