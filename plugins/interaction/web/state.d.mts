export interface Card {
	id: string;
	title: string;
	prompt: string;
	kind: "choice" | "form";
	options?: Array<{ id: string; label: string }>;
	next?: Card;
	autoClose?: boolean;
}
export interface Step {
	value?: string;
	card: Card;
	answer: string;
	at: number;
}
export interface Interaction {
	id: string;
	title: string;
	card: Card;
	steps: Step[];
	draft: string;
	completed: boolean;
	autoClose: boolean;
}
export interface State {
	draft: string;
	choice: string | null;
	history: Array<{ text: string; at: number }>;
	sessions: Interaction[];
	active: Interaction | null;
}
export const STORAGE_KEY: string;
export function validateCard(value: unknown, depth?: number): Card;
export function emptyState(): State;
export function readState(raw: string | null): State;
export function beginTask(state: State, card: Card, id: string): State;
export function completeStep(state: State, answer: string, at: number): State;
