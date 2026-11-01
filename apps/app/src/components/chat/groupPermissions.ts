import type { Actor, ConversationDetail } from "../../api/types";
export type GroupMember = ConversationDetail["members"][number];
export function groupPermissions(detail: ConversationDetail, me?: Actor) {
	const hasOwner = detail.members.some((m) => m.role === "owner");
	const role =
		me && !me.anonymous && hasOwner ? (detail.selfRole ?? detail.members.find((m) => m.id === me.id)?.role) : undefined;
	return {
		role,
		owner: role === "owner",
		manage: role === "owner" || role === "admin",
		hasOwner,
	};
}
export function canMuteMember(role: string | undefined, selfId: string | undefined, member: GroupMember) {
	return (
		!!selfId &&
		selfId !== member.id &&
		member.role !== "owner" &&
		(role === "owner" || (role === "admin" && member.role !== "admin"))
	);
}
export function canAssignRole(role: string | undefined, selfId: string | undefined, member: GroupMember) {
	return (
		!!selfId &&
		role === "owner" &&
		member.id !== selfId &&
		member.kind === "human" &&
		!member.anonymous &&
		member.role !== "owner"
	);
}
