import type { Request, Response } from 'express';
import { requireAuthStrict } from '@lasyncro/backend-core/middleware/requireAuthStrict.js';
import { requireShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { audit } from '../../utils/audit.js';
import {
  disconnectShopifyApp,
  readShopifyDisconnectState,
  type ShopifyDisconnectMode,
} from '../../services/shopify/shopifyAppDisconnect.service.js';

/**
 * GH-979 SECTION C — owner-only Shopify disconnect.
 *
 * Authority is NON-CONFIGURABLE: the current DB membership role must be
 * 'owner' for the authenticated tenant. Neither the JWT role claim nor the
 * configurable integrations:write policy (owner/admin) is sufficient.
 */
type OwnerAuthority =
  | { ok: true; userId: number; shopId: number; isOwner: boolean }
  | { ok: false; status: number; error: string };

async function resolveOwnerAuthority(req: Request): Promise<OwnerAuthority> {
  const { userId, shopId } = requireAuthStrict(req);
  if (shopId === undefined) return { ok: false, status: 403, error: 'SHOP_CONTEXT_REQUIRED' };
  let context;
  try {
    context = await requireShopContextForUser(userId);
  } catch {
    return { ok: false, status: 403, error: 'SHOP_CONTEXT_REQUIRED' };
  }
  if (context.shopId !== shopId) return { ok: false, status: 403, error: 'SHOP_CONTEXT_MISMATCH' };
  return { ok: true, userId, shopId, isOwner: context.role === 'owner' };
}

/**
 * GET /api/v1/integrations/shopify/disconnect/capability
 * Also reports an unresolved disconnect (status only, no provider detail) so
 * every member sees why Shopify is not ready; acting on it stays owner-only.
 */
export const getShopifyDisconnectCapability = async (req: Request, res: Response) => {
  try {
    const authority = await resolveOwnerAuthority(req);
    if (!authority.ok) return res.status(authority.status).json({ error: authority.error });
    const disconnect = await readShopifyDisconnectState(authority.shopId);
    return res.status(200).json({ canDisconnectShopify: authority.isOwner, disconnect });
  } catch (error) {
    console.error('[shopifyDisconnect.controller] Capability authority unavailable', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return res.status(503).json({ error: 'PERMISSION_AUTHORITY_UNAVAILABLE', retryable: true });
  }
};

/** POST /api/v1/integrations/shopify/disconnect  body: { confirmShopDomain } */
export const disconnectShopify = (req: Request, res: Response) => handleDisconnect(req, res, 'UNINSTALL');

/**
 * POST /api/v1/integrations/shopify/disconnect/reconcile  body: { confirmShopDomain }
 * Re-checks an unresolved disconnect. Never starts or repeats an uninstall.
 */
export const reconcileShopifyDisconnect = (req: Request, res: Response) => handleDisconnect(req, res, 'RECONCILE');

async function handleDisconnect(req: Request, res: Response, mode: ShopifyDisconnectMode) {
  let authority: OwnerAuthority;
  try {
    authority = await resolveOwnerAuthority(req);
  } catch (error) {
    console.error('[shopifyDisconnect.controller] Owner authority unavailable', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return res.status(503).json({ error: 'PERMISSION_AUTHORITY_UNAVAILABLE', retryable: true });
  }
  if (!authority.ok) return res.status(authority.status).json({ error: authority.error });

  const { userId, shopId } = authority;
  if (!authority.isOwner) {
    audit({ level: 'SECURITY', event: 'shopify.disconnect.denied', userId, shopId,
      metadata: { reason: 'OWNER_REQUIRED' } });
    return res.status(403).json({ error: 'OWNER_REQUIRED' });
  }

  const confirmShopDomain = (req.body as { confirmShopDomain?: unknown } | undefined)?.confirmShopDomain;
  if (typeof confirmShopDomain !== 'string' || !confirmShopDomain.trim() || confirmShopDomain.length > 255) {
    return res.status(400).json({ error: 'DISCONNECT_CONFIRMATION_REQUIRED' });
  }

  audit({ level: 'SECURITY', event: 'shopify.disconnect.requested', userId, shopId, metadata: { mode } });
  let result;
  try {
    result = await disconnectShopifyApp({ shopId, confirmShopDomain, mode });
  } catch (error) {
    // Thrown only before any durable uninstall intent: nothing was sent.
    console.error('[shopifyDisconnect.controller] Disconnect failed before provider uninstall', {
      shopId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return res.status(500).json({ error: 'SHOPIFY_DISCONNECT_FAILED', retryable: true });
  }
  audit({ level: 'SECURITY', event: 'shopify.disconnect.outcome', userId, shopId,
    metadata: { mode, outcome: result.kind } });

  switch (result.kind) {
    case 'DISCONNECTED':
      return res.status(200).json({ status: 'SHOPIFY_DISCONNECTED', shopDomain: result.shopDomain,
        connectionState: result.connectionState });
    case 'PENDING_CONFIRMATION':
      return res.status(202).json({ status: 'SHOPIFY_DISCONNECT_PENDING_CONFIRMATION', shopDomain: result.shopDomain,
        reason: result.reason });
    case 'IN_PROGRESS':
      return res.status(409).json({ error: 'SHOPIFY_DISCONNECT_IN_PROGRESS', retryable: true });
    case 'NOT_CONNECTED':
      return res.status(409).json({ error: 'SHOPIFY_NOT_CONNECTED', connectionState: result.connectionState });
    case 'CONFIRMATION_MISMATCH':
      return res.status(409).json({ error: 'DISCONNECT_CONFIRMATION_MISMATCH' });
    case 'CREDENTIAL_UNAVAILABLE':
      return result.retryable
        ? res.status(503).json({ error: 'SHOPIFY_CREDENTIAL_UNAVAILABLE', retryable: true })
        : res.status(409).json({ error: 'SHOPIFY_REAUTH_REQUIRED' });
    case 'IDENTITY_MISMATCH':
      return res.status(409).json({ error: 'SHOPIFY_IDENTITY_MISMATCH' });
    case 'PROVIDER_UNAVAILABLE':
      return res.status(result.retryable ? 503 : 409).json({
        error: result.retryable ? 'SHOPIFY_UNAVAILABLE' : 'SHOPIFY_AUTHORIZATION_REJECTED',
        retryable: result.retryable,
      });
    case 'REJECTED':
      return res.status(422).json({ error: 'SHOPIFY_DISCONNECT_REJECTED', providerErrorCodes: result.providerErrorCodes });
    case 'OUTCOME_UNKNOWN':
      return res.status(502).json({ error: 'SHOPIFY_DISCONNECT_OUTCOME_UNKNOWN', retryable: false,
        shopDomain: result.shopDomain, recovery: result.recovery });
    case 'NOT_UNINSTALLED':
      return res.status(409).json({ error: 'SHOPIFY_DISCONNECT_NOT_APPLIED', shopDomain: result.shopDomain });
    case 'NO_UNRESOLVED_DISCONNECT':
      return res.status(409).json({ error: 'SHOPIFY_DISCONNECT_NOT_PENDING', connectionState: result.connectionState });
  }
}
