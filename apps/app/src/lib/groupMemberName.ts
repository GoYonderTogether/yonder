import type { Actor } from "../api/types";
export function groupMemberName(member: Pick<Actor, "name"> & { nickname?: string | null }) {
	return member.nickname?.trim() || member.name;
}
export function validateGroupNickname(value: string) {
	const nickname = value.trim();
	if (Array.from(nickname).length > 32) return "昵称最多 32 个字符";
	if (
		Array.from(nickname).some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 32 || (code >= 127 && code <= 159);
		})
	)
		return "昵称不能包含换行或控制字符";
	return undefined;
}
