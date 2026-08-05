import type { Knex } from 'knex';
export interface PreTenantAuthUser {
    id: number;
    shop_id: number;
    email: string;
    password_hash: string;
    first_name?: string | null;
    last_name?: string | null;
    created_at: string;
    updated_at: string;
    preferred_mode?: 'survival' | 'growth' | 'architect';
    detected_mode?: 'survival' | 'growth' | 'architect';
    shopify_connected?: boolean;
    stripe_connected?: boolean;
    email_verified_at?: string | null;
    entry_channel?: string | null;
    profile_prompt_dismissed_at?: string | null;
}
export interface PreTenantRefreshToken {
    id: number;
    user_id: number;
    shop_id: number;
    session_id: string;
    token_version: number;
    expires_at: Date;
    revoked_at: Date | null;
    ip_address?: string | null;
    user_agent?: string | null;
}
export interface PreTenantMembership {
    shopId: number;
    role: 'owner' | 'admin' | 'operator' | 'viewer';
    displayCurrency: string;
    locale: string;
}
export declare function authEmailExists(email: string): Promise<boolean>;
export declare function resolveAuthUserByEmail(email: string): Promise<PreTenantAuthUser | null>;
export declare function resolveEmailVerificationUser(token: string): Promise<{
    id: number;
    shop_id: number;
    email_verified_at: string | null;
    email_verification_expires_at: string | null;
} | null>;
export declare function resolvePasswordResetUser(token: string): Promise<{
    id: number;
    shop_id: number;
    password_reset_expires_at: string | null;
} | null>;
export declare function resolveRefreshToken(params: {
    tokenHash: string;
    sessionId: string;
    tokenVersion: number;
}): Promise<PreTenantRefreshToken | null>;
export declare function revokeRefreshToken(tokenHash: string): Promise<boolean>;
export declare function resolveActiveShopMemberships(userId: number): Promise<PreTenantMembership[]>;
export declare function createTenantShop(trx: Knex.Transaction, name: string): Promise<number>;
export declare function listPendingCommands<T>(limit?: number): Promise<T[]>;
export declare function listPendingDecisionExecutions<T>(limit?: number): Promise<T[]>;
export declare function resolveCarrierWebhookToken(tokenHash: string, carrierCode: string): Promise<{
    id: string;
    shop_id: number;
} | null>;
