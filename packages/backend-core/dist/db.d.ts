import knex from 'knex';
import type { Knex } from 'knex';
import { runWithTenantContext } from './tenant-context.js';
export { runWithTenantContext };
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
/**
 * Explicit pre-tenant transaction for narrowly scoped authentication and
 * OAuth state operations. PostgreSQL RLS still applies; this only makes the
 * application-level exception visible and reviewable.
 */
export declare function systemTransaction<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
/**
 * Mark a pooled query as belonging to one expected tenant.
 *
 * Prefer withTenant(). This helper exists for callers that already own a
 * correctly scoped connection and need the application guard to verify it.
 */
export declare function tenantQuery<T>(shopId: number, qb: T): T;
export declare function setTenantContext(trx: Knex.Transaction, shopId: number): Promise<void>;
export declare function withTenant<T>(shopId: number, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
export default db;
export interface RuntimeDatabaseIdentity {
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
}
export declare function getRuntimeDatabaseIdentity(): Promise<RuntimeDatabaseIdentity>;
export declare function assertRuntimeDatabaseIdentity(): Promise<void>;
