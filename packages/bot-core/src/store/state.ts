export interface BudgetFacts {
	tokens: number;
	runs: number;
	first?: string;
	opened?: string;
	seen: string[];
}
export interface NotificationStore {
	list(): Promise<Array<{ key: string; value: string }>>;
	set(key: string, value: string | null): Promise<void>;
}
