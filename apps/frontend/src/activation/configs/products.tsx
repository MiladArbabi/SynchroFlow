import { ActivationSurfaceProps } from "@lasyncro/shared/ui/activation";

export const productsActivationConfig: ActivationSurfaceProps = {
  moduleId: 'products',

  identity: {
    title: 'Products',
    subtitle: 'Replenishment decisions are made without visibility',
  },

  blindness: {
    subject: 'SKU P-101',
    dimension: 'stockout risk and restock priority',
    status: 'unknown',
  },

  absenceProof: {
    riskStatement:
      'Restocking decisions may prioritize the wrong products.',
  },

  valueAfterActivation: {
    outcome:
      'Stockout risk and replenishment priority become visible.',
  },

  primaryCTA: {
    label: 'Identify Stockout Risk',
    actionId: 'connect-store',
  },

  trust: {
    bullets: [
      'Read-only access',
      'No store changes',
      'No customer data stored',
      'Encrypted end-to-end',
      'Disconnect anytime',
    ],
  },

  postActivation: {
    reflection:
      'Product data exists. LaSyncro confirms decision impact.'
  },
};
