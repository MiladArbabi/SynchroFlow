import knex from 'knex';
declare const baseDb: knex.Knex<any, unknown[]>;
declare const db: knex.Knex<any, unknown[]>;
/**
 * SYSTEM QUERY BYPASS (EXPLICIT ONLY)
 * -----------------------------------
 * Use ONLY for:
 * - bootstrap
 * - auth (pre-tenant)
 * - migrations / infra
 *
 * NEVER use in domain logic.
 */
export declare function systemQuery(qb: any): any;
export declare function withTenant<T>(shopId: number, fn: (trx: typeof baseDb) => Promise<T>): Promise<T>;
export default db;
export declare const systemDb: knex.Knex<any, unknown[]>;
