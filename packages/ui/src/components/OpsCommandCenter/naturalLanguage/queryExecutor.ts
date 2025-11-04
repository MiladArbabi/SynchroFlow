//packages/ui/src/components/OpsCommandCenter/naturalLanguage/queryExecutor.ts
import { OpsAction } from 'components/OpsCommandCenter/types';
import { OpsContextState } from 'contexts/OpsContext';
import { Intent, EntityMap } from 'components/OpsCommandCenter/naturalLanguage/types';
import { NavigateFunction } from 'react-router-dom';

/**
 * A helper to build URL search parameters from an entity map.
 * e.g., { status: 'unfulfilled' } => 'status=unfulfilled'
 */
const buildQueryString = (entities: EntityMap): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entities)) {
    if (value) {
      params.append(key, String(value));
    }
  }
  return params.toString();
};

/**
 * Dynamically creates a "Find Orders" action based on the entities.
 */
const createFindOrdersAction = (entities: EntityMap): OpsAction => {
  // Build a human-readable name for the action
  let name = 'Find orders';
  if (entities.status) {
    name += ` with status "${entities.status}"`;
  }
  if (entities.date) {
    name += ` from ${entities.date}`;
  }

  return {
    id: 'find-orders-nlp',
    name: name,
    description: `Dynamically generated action for: ${Object.values(entities).join(', ')}`,
    keywords: ['find', 'orders', 'nlp'],
    category: 'analytical',
    context: { pages: ['*'] }, // NLP actions are global
    execute: async (
      _context: OpsContextState,
      navigate: NavigateFunction,
    ) => {
      // Build the URL, e.g., /orders?status=unfulfilled&date=yesterday
      const queryString = buildQueryString(entities);
      navigate(`/orders?${queryString}`);
      return { success: true, message: `Searching for orders...` };
    },
  };
};

/**
 * Dynamically creates a "Check Inventory" action based on the entities.
 */
const createInventoryCheckAction = (entities: EntityMap): OpsAction => {
  let name = 'Check inventory';
  if (entities.product) {
    name += ` for "${entities.product}"`;
  }

  return {
    id: 'check-inventory-nlp',
    name: name,
    description: `Dynamically generated inventory check`,
    keywords: ['inventory', 'check', 'stock', 'nlp'],
    category: 'analytical',
    context: { pages: ['*'] },
    execute: async (
      _context: OpsContextState,
      navigate: NavigateFunction,
    ) => {
      const queryString = buildQueryString(entities);
      navigate(`/inventory?${queryString}`);
      return { success: true, message: 'Checking inventory...' };
    },
  };
};

/**
 * Main executor function.
 * Takes a recognized intent and dynamically creates an executable OpsAction.
 *
 * @param intent The recognized Intent object from the intentParser.
 * @returns A dynamically created OpsAction, or null if the intent is not executable.
 */
export const executeNaturalLanguage = (intent: Intent): OpsAction | null => {
  const { name, entities } = intent;

  // Map the intent name to the correct action-builder function
  switch (name) {
    case 'find-orders':
      return createFindOrdersAction(entities);

    case 'check-inventory':
      return createInventoryCheckAction(entities);
    
    // We'll add more cases here (refund-order, customer-lookup, etc.)
    
    default:
      // Return null for 'search' or any other unhandled intent
      return null;
  }
};