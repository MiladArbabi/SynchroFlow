/** Provider identity for the single line of each dev-seed QA order. */
export function devSeedLineItemId(shopId: number, externalOrderId: string): string {
  if (!Number.isInteger(shopId) || shopId <= 0 || shopId > 2147483647 ||
      !/^80000[1-3]$/.test(externalOrderId)) {
    throw new Error('DEV_SEED_LINE_ID_INVALID: expected a shop ID and QA order 800001–800003');
  }

  // Fixed-width fields make (shop, QA order) injective, without relying on
  // insertion order, clock time or randomness. 98 reserves this fixture's
  // numeric namespace; persisted IDs remain stable when the seed is rerun.
  return `gid://shopify/LineItem/98${String(shopId).padStart(10, '0')}${externalOrderId}`;
}
