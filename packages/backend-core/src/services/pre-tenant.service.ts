import type { Knex } from 'knex';
import db, { systemQuery } from '../db.js';

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

async function resolveJson<T>(sql: string, bindings: any[]): Promise<T | null> {
  const result = await systemQuery(db.raw(sql, bindings));
  return (result.rows?.[0]?.value as T | null | undefined) ?? null;
}

export async function authEmailExists(email: string): Promise<boolean> {
  const value = await resolveJson<boolean>(
    'SELECT public.auth_email_exists(?) AS value',
    [email]
  );
  return value === true;
}

export async function resolveAuthUserByEmail(
  email: string
): Promise<PreTenantAuthUser | null> {
  return resolveJson<PreTenantAuthUser>(
    'SELECT public.resolve_auth_user_by_email(?) AS value',
    [email]
  );
}

export async function resolveEmailVerificationUser(
  token: string
): Promise<{
  id: number;
  shop_id: number;
  email_verified_at: string | null;
  email_verification_expires_at: string | null;
} | null> {
  return resolveJson(
    'SELECT public.resolve_email_verification_user(?) AS value',
    [token]
  );
}

export async function resolvePasswordResetUser(
  token: string
): Promise<{
  id: number;
  shop_id: number;
  password_reset_expires_at: string | null;
} | null> {
  return resolveJson('SELECT public.resolve_password_reset_user(?) AS value', [
    token,
  ]);
}

export async function resolveRefreshToken(params: {
  tokenHash: string;
  sessionId: string;
  tokenVersion: number;
}): Promise<PreTenantRefreshToken | null> {
  const token = await resolveJson<Omit<PreTenantRefreshToken, 'expires_at' | 'revoked_at'> & {
    expires_at: string;
    revoked_at: string | null;
  }>(
    'SELECT public.resolve_refresh_token(?, ?::uuid, ?) AS value',
    [params.tokenHash, params.sessionId, params.tokenVersion]
  );

  if (!token) return null;

  return {
    ...token,
    expires_at: new Date(token.expires_at),
    revoked_at: token.revoked_at ? new Date(token.revoked_at) : null,
  };
}

export async function revokeRefreshToken(tokenHash: string): Promise<boolean> {
  const revoked = await resolveJson<boolean>(
    'SELECT public.revoke_refresh_token(?) AS value',
    [tokenHash]
  );
  return revoked === true;
}

export async function resolveActiveShopMemberships(
  userId: number
): Promise<PreTenantMembership[]> {
  const memberships = await resolveJson<PreTenantMembership[]>(
    'SELECT public.resolve_active_shop_memberships(?) AS value',
    [userId]
  );
  return memberships ?? [];
}

export async function createTenantShop(
  trx: Knex.Transaction,
  name: string
): Promise<number> {
  const result = await trx.raw(
    'SELECT public.create_tenant_shop(?) AS shop_id',
    [name]
  );
  const shopId = Number(result.rows?.[0]?.shop_id);

  if (!Number.isInteger(shopId) || shopId <= 0) {
    throw new Error('TENANT_BOOTSTRAP_FAILED');
  }

  return shopId;
}

export async function listPendingCommands<T>(limit = 50): Promise<T[]> {
  const result = await systemQuery(
    db.raw(
      'SELECT public.list_pending_commands(?) AS value',
      [limit]
    )
  );
  return result.rows.map((row: { value: T }) => row.value);
}

export async function listPendingDecisionExecutions<T>(
  limit = 50
): Promise<T[]> {
  const result = await systemQuery(
    db.raw(
      'SELECT public.list_pending_decision_executions(?) AS value',
      [limit]
    )
  );
  return result.rows.map((row: { value: T }) => row.value);
}

export async function resolveCarrierWebhookToken(
  tokenHash: string,
  carrierCode: string
): Promise<{ id: string; shop_id: number } | null> {
  return resolveJson(
    'SELECT public.resolve_carrier_webhook_token(?, ?) AS value',
    [tokenHash, carrierCode]
  );
}
