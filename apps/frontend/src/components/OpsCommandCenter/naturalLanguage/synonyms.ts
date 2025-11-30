//apps/frontend/src/components/OpsCommandCenter/naturalLanguage/synonyms.ts
/**
 * A simple dictionary for expanding search terms.
 * This makes our L1 search "smarter" by checking for common synonyms.
 *
 * The key is the "search term" the user might type.
 * The value is the "target term" that exists in our OpsAction keywords.
 */
export const SYNONYM_MAP: Record<string, string> = {
  // --- ORDER ---
  return: 'refund',
  money: 'refund',
  cancel: 'refund', // Or a different "cancel" intent later
  sale: 'order',
  purchase: 'order',

  // --- CUSTOMER ---
  client: 'customer',
  user: 'customer',
  shopper: 'customer',
  person: 'customer',

  // --- INVENTORY ---
  stock: 'inventory',
  product: 'inventory',
  
  // --- GENERAL ---
  go: 'view',
  show: 'view',
  see: 'view',
  find: 'view',
  search: 'view',
  main: 'dashboard',
  home: 'dashboard',
};