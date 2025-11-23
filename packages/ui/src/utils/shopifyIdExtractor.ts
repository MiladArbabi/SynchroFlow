// packages/ui/src/utils/shopifyIdExtractor.ts
/**
 * Extracts numeric ID from Shopify GID
 * @param gid Shopify Global ID (e.g., "gid://shopify/Order/123456789")
 * @returns Numeric ID as string (e.g., "123456789")
 */
export const extractShopifyId = (gid: string): string => {
  if (!gid || typeof gid !== 'string') return gid;
  
  // Handle both full GID and already extracted IDs
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
};

/**
 * Checks if a string is a Shopify GID
 */
export const isShopifyGid = (id: string): boolean => {
  return typeof id === 'string' && id.startsWith('gid://shopify/');
};