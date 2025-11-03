// packages/ui/src/components/OpsCommandCenter/commandDefinitions.ts
/* eslint-disable @typescript-eslint/no-unused-vars */
import { OpsAction } from './types';

// This is the "single source of truth" for all Layer 1 commands.
// We will add 10+ actions here as we build out features.

const executeNavigate = (path: string) => async () => {
  // In a real app, we'd use a navigate() hook.
  // For now, window.location is a fine placeholder for the action.
  window.location.pathname = path;
  return { success: true, message: `Navigating to ${path}` };
};

export const ALL_ACTIONS: OpsAction[] = [
  // --- Navigation Actions ---
  {
    id: 'nav-dashboard',
    name: 'Go to Dashboard',
    description: 'View the main operations dashboard',
    keywords: ['home', 'main', 'dashboard', 'analytics'],
    icon: 'dashboard',
    category: 'safe',
    context: { pages: ['*'] }, // '*' means global
    execute: executeNavigate('/dashboard'),
  },
  {
    id: 'nav-orders',
    name: 'View Orders',
    description: 'Find and manage all orders',
    keywords: ['orders', 'shipping', 'fulfillment'],
    icon: 'orders',
    category: 'safe',
    context: { pages: ['*'] },
    execute: executeNavigate('/orders'),
  },
  {
    id: 'nav-customers',
    name: 'View Customers',
    description: 'Find and manage all customers',
    keywords: ['customers', 'csm', 'users', 'people'],
    icon: 'customer',
    category: 'safe',
    context: { pages: ['*'] },
    execute: executeNavigate('/customers'),
  },

  // --- Search/Action Placeholders ---
  {
    id: 'find-order-by-id',
    name: 'Find Order by ID...',
    description: 'Look up a specific order by its number',
    keywords: ['order', 'find', 'search', 'lookup'],
    icon: 'search',
    category: 'analytical',
    context: { pages: ['dashboard', 'orders'] },
    execute: async () => {
      console.log('TODO: Open "Find Order" modal');
      return { success: true, message: 'Opening order search...' };
    },
  },
  {
    id: 'find-customer-by-email',
    name: 'Find Customer by Email...',
    description: 'Look up a specific customer by their email',
    keywords: ['customer', 'find', 'search', 'email'],
    icon: 'search',
    category: 'analytical',
    context: { pages: ['dashboard', 'customers'] },
    execute: async () => {
      console.log('TODO: Open "Find Customer" modal');
      return { success: true, message: 'Opening customer search...' };
    },
  },

  // --- Destructive Action Placeholder ---
  {
    id: 'refund-last-order',
    name: 'Refund Last Order...',
    description: 'Open the refund prompt for the most recent order',
    keywords: ['refund', 'return', 'cancel', 'money'],
    icon: 'refund',
    category: 'destructive',
    context: {
      pages: ['dashboard', 'orders'],
      requiredPermissions: ['refund:write'],
    },

    confirmationMessage: 'Are you sure you want to refund the last order?',
    
    execute: async () => {
      console.log('TODO: Open refund modal for last order');
      return { success: true, message: 'Opening refund modal...' };
    },
  },
  
  // ... We will add more actions for inventory, products, etc.
  // This is a good start.
];
