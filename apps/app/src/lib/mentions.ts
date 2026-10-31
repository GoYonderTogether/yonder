export interface MentionToken {
	start: number;
	end: number;
	label: string;
	id?: string;
	all?: boolean;
}
export function mentionQuery(text: string, caret: number) {
	const match = /(?:^|[^a-zA-Z0-9._%+-])@([^\s@]*)$/.exec(text.slice(0, caret));
	return match ? { start: caret - match[1].length - 1, end: caret, query: match[1] } : null;
}
export function editedMentions(previous: string, next: string, tokens: MentionToken[]): MentionToken[] {
	let start = 0;
	while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
	let tail = 0;
	while (
		tail < previous.length - start &&
		tail < next.length - start &&
		previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
	)
		tail++;
	const end = previous.length - tail,
		delta = next.length - previous.length;
	return tokens.flatMap((token) => {
		if (end === start ? start > token.start && start < token.end : start < token.end && end > token.start) return [];
		const shifted = token.start >= end ? { ...token, start: token.start + delta, end: token.end + delta } : token;
		return next.slice(shifted.start, shifted.end) === shifted.label ? [shifted] : [];
	});
}
export function mentionMetadata(text: string, tokens: MentionToken[]) {
	const valid = tokens.filter((t) => text.slice(t.start, t.end) === t.label);
	const mentions = [...new Set(valid.flatMap((t) => (t.id ? [t.id] : [])))];
	return { ...(mentions.length ? { mentions } : {}), ...(valid.some((t) => t.all) ? { mentionAll: true } : {}) };
}
