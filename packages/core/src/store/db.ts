/** Yonder 侧看到的数据库接口（07 §2）：与 pi 共用同一个 `node:sqlite` 连接，不另开第二个连接。 */
export type DbValue = null | number | bigint | string | Uint8Array;
export interface DbExecutor {
	exec(sql: string): Promise<void>;
	run(sql: string, ...params: DbValue[]): Promise<void>;
	get<T extends object>(sql: string, ...params: DbValue[]): Promise<T | undefined>;
	all<T extends object>(sql: string, ...params: DbValue[]): Promise<T[]>;
}
export interface Db extends DbExecutor {
	transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}
