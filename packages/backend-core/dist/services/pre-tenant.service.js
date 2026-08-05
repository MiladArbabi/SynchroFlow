import db, { systemQuery } from '../db.js';
async function resolveJson(sql, bindings) {
    const result = await systemQuery(db.raw(sql, bindings));
    return result.rows?.[0]?.value ?? null;
}
export async function authEmailExists(email) {
    const value = await resolveJson('SELECT public.auth_email_exists(?) AS value', [email]);
    return value === true;
}
export async function resolveAuthUserByEmail(email) {
    return resolveJson('SELECT public.resolve_auth_user_by_email(?) AS value', [email]);
}
export async function resolveEmailVerificationUser(token) {
    return resolveJson('SELECT public.resolve_email_verification_user(?) AS value', [token]);
}
export async function resolvePasswordResetUser(token) {
    return resolveJson('SELECT public.resolve_password_reset_user(?) AS value', [
        token,
    ]);
}
export async function resolveRefreshToken(params) {
    const token = await resolveJson('SELECT public.resolve_refresh_token(?, ?::uuid, ?) AS value', [params.tokenHash, params.sessionId, params.tokenVersion]);
    if (!token)
        return null;
    return {
        ...token,
        expires_at: new Date(token.expires_at),
        revoked_at: token.revoked_at ? new Date(token.revoked_at) : null,
    };
}
export async function revokeRefreshToken(tokenHash) {
    const revoked = await resolveJson('SELECT public.revoke_refresh_token(?) AS value', [tokenHash]);
    return revoked === true;
}
export async function resolveActiveShopMemberships(userId) {
    const memberships = await resolveJson('SELECT public.resolve_active_shop_memberships(?) AS value', [userId]);
    return memberships ?? [];
}
export async function createTenantShop(trx, name) {
    const result = await trx.raw('SELECT public.create_tenant_shop(?) AS shop_id', [name]);
    const shopId = Number(result.rows?.[0]?.shop_id);
    if (!Number.isInteger(shopId) || shopId <= 0) {
        throw new Error('TENANT_BOOTSTRAP_FAILED');
    }
    return shopId;
}
export async function listPendingCommands(limit = 50) {
    const result = await systemQuery(db.raw('SELECT public.list_pending_commands(?) AS value', [limit]));
    return result.rows.map((row) => row.value);
}
export async function listPendingDecisionExecutions(limit = 50) {
    const result = await systemQuery(db.raw('SELECT public.list_pending_decision_executions(?) AS value', [limit]));
    return result.rows.map((row) => row.value);
}
export async function resolveCarrierWebhookToken(tokenHash, carrierCode) {
    return resolveJson('SELECT public.resolve_carrier_webhook_token(?, ?) AS value', [tokenHash, carrierCode]);
}
