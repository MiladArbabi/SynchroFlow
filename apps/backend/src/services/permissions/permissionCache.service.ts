// apps/backend/src/services/permissions/permissionCache.service.ts
//
// PERMISSION CACHE SERVICE (WM-19 v2)
// -------------------------------------
// Redis-backed cache for shop role permissions.
//
// Cache key: permissions:shop:{shopId}
// TTL: 5 minutes (300 seconds)
// Value: JSON map of { [action:role]: boolean }
//
// Read path:
//   1. Check Redis cache
//   2. On miss: load from shop_role_permissions table
//   3. On table miss (new shop / pre-seed): fall back to ACTION_ROLE_MAP defaults
//   4. Store in Redis for 5 minutes
//
// Invalidation:
//   Call invalidatePermissionCache(shopId) after any permission change.
//   Called by permissionSettings.service.ts on every PATCH.
//
// Failure contract:
//   Redis failure → fall back to DB read (never fail closed on cache error)
//   DB failure → propagate error (permissions must be authoritative)

import db from '@lasyncro/backend-core/db.js';
import { getRedisClient } from '@lasyncro/backend-core/services/redis.client.js';
import { ACTION_ROLE_MAP } from '../../middleware/require-action.middleware.js';

const CACHE_TTL_SECONDS = 300; // 5 minutes
const cacheKey = (shopId: number) => `permissions:shop:${shopId}`;

export type PermissionMap = Record<string, boolean>; // key: "action:role"

/**
 * Load permissions for a shop from DB.
 * Falls back to ACTION_ROLE_MAP defaults if no rows exist.
 */
async function loadFromDb(shopId: number): Promise<PermissionMap> {
  const rows = await db('shop_role_permissions')
    .where({ shop_id: shopId })
    .select('action', 'role', 'granted');

  // No rows = shop not yet seeded → fall back to static defaults
  if (rows.length === 0) {
    const map: PermissionMap = {};
    for (const [action, roles] of Object.entries(ACTION_ROLE_MAP)) {
      for (const role of ['owner', 'admin', 'operator']) {
        map[`${action}:${role}`] = (roles as string[]).includes(role);
      }
    }
    return map;
  }

  const map: PermissionMap = {};
  for (const row of rows) {
    map[`${row.action}:${row.role}`] = row.granted;
  }
  return map;
}

/**
 * Get the permission map for a shop.
 * Cache-first: Redis → DB → ACTION_ROLE_MAP fallback.
 */
export async function getPermissionMap(shopId: number): Promise<PermissionMap> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(cacheKey(shopId));

    if (cached) {
      return JSON.parse(cached) as PermissionMap;
    }
  } catch (err) {
    // Redis unavailable — fall through to DB
    console.warn('[permissionCache] Redis read failed, falling back to DB:', (err as Error).message);
  }

  const map = await loadFromDb(shopId);

  // Store in Redis — best effort, non-blocking
  try {
    const redis = getRedisClient();
    await redis.set(cacheKey(shopId), JSON.stringify(map), { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    console.warn('[permissionCache] Redis write failed:', (err as Error).message);
  }

  return map;
}

/**
 * Check if a specific role can perform an action for a shop.
 * This is the hot path — called by requireAction on every request.
 */
export async function isActionAllowed(
  shopId: number,
  action: string,
  role: string
): Promise<boolean> {
  const map = await getPermissionMap(shopId);
  const key = `${action}:${role}`;

  // If key not in map (new action added after seed), fall back to ACTION_ROLE_MAP default
  if (!(key in map)) {
    const defaultRoles = ACTION_ROLE_MAP[action] ?? [];
    return (defaultRoles as string[]).includes(role);
  }

  return map[key] === true;
}

/**
 * Invalidate the permission cache for a shop.
 * Must be called after any permission change.
 */
export async function invalidatePermissionCache(shopId: number): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(cacheKey(shopId));
    console.info('[permissionCache] Cache invalidated for shop:', shopId);
  } catch (err) {
    console.warn('[permissionCache] Redis invalidation failed:', (err as Error).message);
  }
}