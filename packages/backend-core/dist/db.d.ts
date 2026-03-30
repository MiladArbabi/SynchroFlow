import knex from 'knex';
declare const baseDb: knex.Knex<any, unknown[]>;
declare const db: knex.Knex<any, unknown[]>;
export declare function withTenant<T>(shopId: number, fn: (trx: typeof baseDb) => Promise<T>): Promise<T>;
export default db;
